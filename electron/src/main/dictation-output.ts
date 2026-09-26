import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ShortcutEvent {
  pressed: boolean;
  session: number;
}

type SessionCommand = { session: number };
export type OutputCommand =
  | { method: 'ping' | 'prime_tray' }
  | { method: 'watch_register'; path: string }
  | { method: 'watch_scan' | 'watch_forget'; token: string }
  | {
      method: 'watch_enqueue';
      backend_url: string;
      authorization: string | null;
      token: string;
      name: string;
      expected_size: number;
      expected_mtime: number;
      langs: string[];
      voice_id: string | null;
      preserve_bg: boolean;
    }
  | { method: 'set_shortcut'; accelerator: string | null }
  | { method: 'begin'; origin: 'shortcut' | 'tray' }
  | ({ method: 'activate' | 'reject' | 'finish' } & SessionCommand)
  | ({ method: 'deliver' | 'copy'; text: string } & SessionCommand)
  | ({ method: 'type_delta'; text: string; backspaces: number } & SessionCommand);

/** Private stdio transport. Never replay a failed request: it may have already typed text. */
export class DictationOutputClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private closed = false;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private executable: string,
    private ownerPid = process.pid,
    private onShortcut: (event: ShortcutEvent) => void = () => {},
  ) {}

  request(command: OutputCommand): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Native output connection closed'));
    if (!this.child) this.start();
    const child = this.child!;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('Native output request timed out')),
        command.method === 'watch_enqueue'
          ? 3_600_000
          : command.method === 'set_shortcut'
            ? 300_000
            : 30_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, ...command }) + '\n', (error) => {
        if (error) this.fail(error);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // EOF lets the shared delivery code restore an owned clipboard lease.
    this.child?.stdin.end();
    this.rejectPending(new Error('Native output connection closed'));
    const child = this.child;
    if (child && child.exitCode === null) {
      const timer = setTimeout(() => this.terminate(), 1000);
      child.once('exit', () => clearTimeout(timer));
    }
  }

  private start(): void {
    this.child = spawn(this.executable, [String(this.ownerPid)], {
      env: { ...process.env, SESLY_DESKTOP_EXE: process.execPath },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let buffered = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      if (this.closed) return;
      buffered += chunk;
      if (buffered.length > 1024 * 1024) {
        this.fail(new Error('Invalid native output response'));
        return;
      }
      let end: number;
      while ((end = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        try {
          const reply = JSON.parse(line) as {
            id: number;
            result?: unknown;
            error?: string;
            event?: string;
            pressed?: boolean;
            session?: number;
          };
          if (reply.event === 'shortcut') {
            if (
              typeof reply.pressed !== 'boolean' ||
              !Number.isSafeInteger(reply.session) ||
              reply.session! <= 0
            )
              throw new Error('Invalid shortcut event');
            this.onShortcut({ pressed: reply.pressed, session: reply.session! });
            continue;
          }
          const request = this.pending.get(reply.id);
          if (!request) throw new Error('Unexpected native output response');
          this.pending.delete(reply.id);
          clearTimeout(request.timer);
          if (reply.error) request.reject(new Error(reply.error));
          else request.resolve(reply.result);
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    });
    this.child.stdout.on('error', (error) => this.fail(error));
    // Consume diagnostics without mixing them into protocol frames or transcript logs.
    this.child.stderr.resume();
    this.child.stderr.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.once('error', (error) => this.fail(error));
    this.child.once('exit', () => {
      this.closed = true;
      this.rejectPending(new Error('Native output helper exited'));
    });
  }

  private fail(error: Error): void {
    this.closed = true;
    this.rejectPending(error);
    this.terminate();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private terminate(): void {
    if (!this.child?.pid || this.child.exitCode !== null) return;
    if (process.platform === 'win32') this.child.kill();
    else {
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
