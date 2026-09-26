const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

export function getContext(): Record<string, unknown> {
  const scope = globalThis as typeof globalThis & {
    [REQUEST_CONTEXT]?: { get?: () => Record<string, unknown> };
  };
  return scope[REQUEST_CONTEXT]?.get?.() ?? {};
}

export async function getVercelOidcToken(): Promise<string> {
  return '';
}

export function getVercelOidcTokenSync(): string {
  return '';
}
