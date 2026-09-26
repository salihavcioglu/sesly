/** Object-URL helpers that tolerate environments without them (jsdom). */

export function createObjectUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export function revokeObjectUrl(url: string | null | undefined): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Already revoked or unsupported — nothing to release.
  }
}
