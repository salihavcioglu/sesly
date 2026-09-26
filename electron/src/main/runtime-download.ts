import { get } from 'node:https';
import { ProxyAgent } from 'proxy-agent';

/** Resolve the setup environment without changing the desktop process environment. */
export function setupProxyForUrl(raw: string, env: NodeJS.ProcessEnv): string {
  const url = new URL(raw);
  const value = (key: string) => env[key.toLowerCase()] || env[key.toUpperCase()] || '';
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  for (const entry of value('no_proxy')
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean)) {
    if (entry === '*') return '';
    const match = /^(.*):(\d+)$/.exec(entry);
    if (match && match[2] !== port) continue;
    const host = match?.[1] ?? entry;
    const suffix = host.replace(/^\*/, '');
    if (
      url.hostname === host ||
      (host.startsWith('.') && url.hostname === host.slice(1)) ||
      (/^[.*]/.test(host) && url.hostname.endsWith(suffix))
    )
      return '';
  }
  const proxy = value(`${url.protocol.slice(0, -1)}_proxy`) || value('all_proxy');
  if (!proxy) return '';
  const candidate = proxy.includes('://') ? proxy : `http://${proxy}`;
  try {
    const parsed = new URL(candidate);
    if (
      !['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(
        parsed.protocol,
      ) ||
      !parsed.hostname
    ) {
      throw new Error('unsupported');
    }
  } catch {
    // proxy-agent includes the entire URL in unsupported-protocol errors.
    // Validate before handing it credentials that could reach setup logs.
    throw new Error('Invalid or unsupported proxy URL; use HTTP, HTTPS, or SOCKS.');
  }
  return candidate;
}

/** Download executable installer text only over HTTPS, including redirects. */
export async function downloadRuntimeInstaller(
  url: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  const agent = new ProxyAgent({ getProxyForUrl: (target) => setupProxyForUrl(target, env) });
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  async function download(target: string, redirects = 0): Promise<string> {
    if (new URL(target).protocol !== 'https:') throw new Error('uv installer requires HTTPS');
    bounded.throwIfAborted();
    return new Promise((resolve, reject) => {
      const request = get(target, { agent, signal: bounded }, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          if (!response.headers.location || redirects >= 5) {
            reject(new Error('uv installer redirect limit exceeded'));
          } else {
            try {
              resolve(download(new URL(response.headers.location, target).href, redirects + 1));
            } catch (error) {
              reject(error);
            }
          }
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`uv installer download failed (${status})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            response.destroy(new Error('uv installer exceeds size limit'));
          } else chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
      });
      request.on('error', reject);
    });
  }
  try {
    return await download(url);
  } finally {
    agent.destroy();
  }
}
