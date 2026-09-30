/** Deployment paths are local URL paths, never a hostname or filesystem path. */
export function normalizeBase(value = '/') {
  if (typeof value !== 'string') throw new Error('The app base must be a URL path.');
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  if (/[?#\\:]/.test(trimmed)) throw new Error('The app base must be a URL path without a query or hostname.');
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || !/^[A-Za-z0-9._~-]+$/.test(part))) throw new Error('Invalid app base path.');
  return `/${parts.join('/')}/`;
}

export function resolveBase({ base, repository } = {}) {
  if (base !== undefined && base !== '') return normalizeBase(base);
  if (!repository) return '/';
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error('Invalid GitHub repository metadata.');
  return parts[1].toLowerCase().endsWith('.github.io') ? '/' : normalizeBase(parts[1]);
}

export function appPath(base, file = '') {
  if (typeof file !== 'string' || file.startsWith('/') || file.includes('..') || /[?#\\:]/.test(file)) throw new Error('Expected a relative app asset path.');
  return `${normalizeBase(base)}${file}`;
}

export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || ['localhost', '::', '::1'].includes(host) || !host.includes('.') && !host.includes(':')
    || /\.(localhost|local|internal|test|invalid)$/.test(host)) return true;
  if (host.includes(':')) return /^(f[cd]|fe[89ab]|::ffff:|2001:db8:)/.test(host);
  if (/^\d+(\.\d+){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

/** Origin + deployment base prevents sharing debug state or player data. */
export function publicAppUrl({ origin, base = '/', production = false } = {}) {
  try {
    const url = new URL(origin);
    if (!production || url.protocol !== 'https:' || isPrivateHost(url.hostname) || url.username || url.password) return null;
    return new URL(normalizeBase(base), url.origin).href;
  } catch { return null; }
}
