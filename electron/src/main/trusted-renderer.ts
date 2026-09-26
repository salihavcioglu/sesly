/** Compare URL components: custom app schemes have a null URL.origin. */
export function isTrustedRenderer(raw: string, dev?: string): boolean {
  try {
    const url = new URL(raw);
    return ['app://sesly', ...(dev ? [dev] : [])].some((value) => {
      const allowed = new URL(value);
      return (
        url.protocol === allowed.protocol &&
        url.hostname === allowed.hostname &&
        url.port === allowed.port &&
        !url.username &&
        !url.password
      );
    });
  } catch {
    return false;
  }
}
