import { execFileSync } from 'node:child_process';

/** Convert WinINET's protocol map into URLs understood by uv. Never log credentials. */
export function parseWinInetProxy(raw: string): NodeJS.ProcessEnv {
  const urls: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const match = /^(http|https|socks)\s*=\s*(.+)$/i.exec(item);
    const scheme = match?.[1].toLowerCase() ?? 'all';
    const address = match?.[2] ?? item;
    if (/\s|=/.test(address)) continue;
    const candidate = address.includes('://')
      ? address
      : `${scheme === 'socks' ? 'socks5h' : 'http'}://${address}`;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol))
        continue;
      if (!url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash)
        continue;
      urls[scheme] = candidate;
    } catch {
      /* A malformed system value is not a valid proxy override. */
    }
  }
  const http = urls.http ?? urls.all ?? urls.socks;
  const https = urls.https ?? urls.all ?? urls.socks;
  return { ...(http ? { HTTP_PROXY: http } : {}), ...(https ? { HTTPS_PROXY: https } : {}) };
}

interface SystemProxy {
  server: string;
  bypass?: string;
}

/** Only translate bypass rules whose meaning NO_PROXY can preserve. */
export function proxyBypassHosts(raw: string): string[] | null {
  const hosts: string[] = [];
  for (const value of raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (value === '*') {
      hosts.push(value);
      continue;
    }
    const host = value.replace(/^\*\./, '.');
    if (!/^[a-z0-9_.:[\]-]+$/i.test(host) || value.includes('<')) return null;
    hosts.push(host);
  }
  return hosts;
}

/** A bounded registry read; denied/unavailable registry access leaves uv's defaults intact. */
function systemProxy(): SystemProxy | undefined {
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', timeout: 2500, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (!/^\s*ProxyEnable\s+REG_DWORD\s+0x0*1\s*$/im.test(output)) return undefined;
    const server = /^\s*ProxyServer\s+REG_SZ\s+(.+)$/im.exec(output)?.[1].trim();
    const bypass = /^\s*ProxyOverride\s+REG_SZ\s+(.+)$/im.exec(output)?.[1].trim();
    return server ? { server, bypass } : undefined;
  } catch {
    return undefined;
  }
}

/** uv download subprocess settings; explicit caller proxies always take precedence. */
export function downloadProxyEnv(
  input: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readSystemProxy: () => string | SystemProxy | undefined = systemProxy,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(input).filter(([key]) => /^(http|https|all|no)_proxy$/i.test(key)),
  );
  const explicit = Object.keys(env).some((key) => /^(http|https|all)_proxy$/i.test(key));
  let systemBypass: string[] = [];
  if (platform === 'win32' && !explicit) {
    const raw = readSystemProxy();
    const settings = typeof raw === 'string' ? { server: raw } : raw;
    const hosts = proxyBypassHosts(settings?.bypass ?? '');
    // Stop before uv can reinterpret the raw registry value as a hostname.
    // Omitting a bypass rule could route private requests through the proxy.
    if (settings && hosts === null) throw new Error('SESLY_PROXY_BYPASS_UNSUPPORTED');
    if (settings && hosts !== null) {
      Object.assign(env, parseWinInetProxy(settings.server));
      systemBypass = hosts;
    }
  }
  const bypass = new Set([
    ...`${env.NO_PROXY ?? ''},${env.no_proxy ?? ''}`
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    ...systemBypass,
    'localhost',
    '127.0.0.1',
    '::1',
  ]);
  env.NO_PROXY = env.no_proxy = [...bypass].join(',');
  return env;
}
