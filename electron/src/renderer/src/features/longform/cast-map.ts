export function castVoice(cast: Record<string, string>, name: string): string {
  return Object.hasOwn(cast, name) && typeof cast[name] === 'string' ? cast[name] : '';
}
