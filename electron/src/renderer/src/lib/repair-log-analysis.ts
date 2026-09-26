import { logSeverity, stripLogAnsi } from './log-format';

export type RepairLogCause = 'hfAccess' | 'memory' | 'port' | 'brokenRuntime' | null;

export function collectRepairLogLines(lines: string[], limit = 60): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const raw of lines) {
    const line = stripLogAnsi(raw).trim();
    if (!line || !['error', 'warning'].includes(logSeverity(line)) || seen.has(line)) continue;
    seen.add(line);
    problems.push(line);
  }
  return problems.slice(-limit);
}

export function repairLogCause(lines: string[]): RepairLogCause {
  const text = lines.join('\n').toLocaleLowerCase();
  if (
    /(?:gated repo|access to model .* restricted|hugging face access)/.test(text) ||
    /(?:huggingface|hugging face)[\s\S]{0,160}(?:403|forbidden)/.test(text)
  ) {
    return 'hfAccess';
  }
  if (/(?:cuda out of memory|outofmemoryerror|cannot allocate memory|oom[- ]kill)/.test(text)) {
    return 'memory';
  }
  if (/(?:address already in use|eaddrinuse|port \d+ is already in use)/.test(text)) return 'port';
  if (
    /(?:modulenotfounderror|dll load failed|undefined symbol)/.test(text) &&
    /(?:torch|torchaudio|torchvision|transformers|soundfile|numpy)/.test(text)
  ) {
    return 'brokenRuntime';
  }
  return null;
}
