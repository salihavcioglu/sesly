import type { OutputCommand } from './dictation-output';
export const DEFAULT_SHORTCUT = 'CmdOrCtrl+Shift+Space';
export interface ShortcutState {
  accelerator: string;
  active: boolean;
  error?: string;
}
export class ShortcutSettings {
  private current: ShortcutState;
  private pending: Promise<unknown> = Promise.resolve();
  private synchronized = '';
  private registered: string | null = null;
  enabled = false;
  mode: 'hold' | 'toggle' = 'toggle';
  constructor(
    private output: { request(command: OutputCommand): Promise<unknown> },
    saved: unknown,
    private persist: (accelerator: string) => Promise<void>,
  ) {
    this.current = {
      accelerator:
        typeof saved === 'string' && saved.length > 0 && saved.length <= 100
          ? saved
          : DEFAULT_SHORTCUT,
      active: false,
    };
  }
  getState(): ShortcutState {
    return { ...this.current };
  }
  synchronize(enabled: boolean, mode: 'hold' | 'toggle'): Promise<ShortcutState> {
    return this.queue(async () => {
      const key = `${enabled}:${mode}`;
      if (key === this.synchronized) return this.getState();
      this.synchronized = key;
      this.enabled = enabled;
      this.mode = mode;
      try {
        await this.register(enabled ? this.current.accelerator : null);
        this.current.error = undefined;
      } catch (error) {
        this.current.error = String(error);
      }
      return this.getState();
    });
  }
  set(accelerator: string): Promise<ShortcutState> {
    if (!accelerator || accelerator.length > 100)
      return Promise.reject(new Error('Invalid shortcut'));
    return this.queue(async () => {
      const previous = this.registered;
      // Validate through the real OS even while dictation is disabled, then remove
      // the temporary registration. Invalid/conflicting values never get saved.
      await this.register(accelerator);
      try {
        if (!this.enabled) await this.register(null);
        await this.persist(accelerator);
      } catch (error) {
        try {
          await this.register(previous);
        } catch (rollback) {
          this.current.error = String(rollback);
          this.current.active = false;
        }
        throw error;
      }
      this.current = { accelerator, active: this.enabled && this.registered !== null };
      return this.getState();
    });
  }
  private async register(accelerator: string | null): Promise<void> {
    if (this.registered === accelerator) return;
    await this.output.request({ method: 'set_shortcut', accelerator });
    this.registered = accelerator;
    this.current.active = accelerator !== null;
  }
  private queue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(run);
    this.pending = next;
    return next;
  }
}
