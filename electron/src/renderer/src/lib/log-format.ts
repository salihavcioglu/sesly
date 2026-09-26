export type LogSeverity = 'error' | 'warning' | 'success' | 'debug' | 'info';

export function stripLogAnsi(line: string): string {
  let clean = '';
  for (let index = 0; index < line.length; index++) {
    if (line.charCodeAt(index) !== 27 || line[index + 1] !== '[') {
      clean += line[index];
      continue;
    }
    index += 2;
    while (index < line.length) {
      const code = line.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) break;
      index++;
    }
  }
  return clean;
}

export function logSeverity(line: string): LogSeverity {
  const value = stripLogAnsi(line);
  if (
    /(?:^|[\s[.:_-])(?:critical|fatal|error|exception|traceback|panic)(?:$|[\s\].:_-])/i.test(
      value,
    ) ||
    /(?:failed|failure|crashed|unexpectedly stopped|unhandled rejection)/i.test(value)
  ) {
    return 'error';
  }
  if (/(?:^|[\s[.:_-])(?:warn|warning)(?:$|[\s\].:_-])|deprecated|retrying/i.test(value)) {
    return 'warning';
  }
  if (/(?:ready|complete|completed|succeeded|healthy|loaded)\b/i.test(value)) return 'success';
  if (/(?:^|[\s[.:_-])(?:debug|trace)(?:$|[\s\].:_-])/i.test(value)) return 'debug';
  return 'info';
}
