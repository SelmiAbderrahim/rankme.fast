type CookieValue = string | number | boolean | object | null;

interface CookieOptions {
  path?: string;
  expires?: Date;
  maxAge?: number;
  domain?: string;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
}

const encode = (value: CookieValue): string => {
  if (typeof value === 'string') return encodeURIComponent(value);
  return encodeURIComponent(JSON.stringify(value));
};

const tryParse = <T>(raw: string): T | string => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw;
  }
};

export const loadCookie = <T = unknown>(name: string): T | null => {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const segments = document.cookie ? document.cookie.split('; ') : [];
  for (const segment of segments) {
    if (segment.startsWith(target)) {
      const raw = decodeURIComponent(segment.slice(target.length));
      return tryParse<T>(raw) as T;
    }
  }
  return null;
};

export const saveCookie = (name: string, value: CookieValue, options: CookieOptions = {}): void => {
  if (typeof document === 'undefined') return;
  const parts = [`${name}=${encode(value)}`];
  parts.push(`path=${options.path ?? '/'}`);
  if (options.expires) parts.push(`expires=${options.expires.toUTCString()}`);
  if (options.maxAge !== undefined) parts.push(`max-age=${options.maxAge}`);
  if (options.domain) parts.push(`domain=${options.domain}`);
  if (options.secure) parts.push('secure');
  if (options.sameSite) parts.push(`samesite=${options.sameSite}`);
  document.cookie = parts.join('; ');
};

export const removeCookie = (name: string, options: CookieOptions = {}): void => {
  saveCookie(name, '', { ...options, expires: new Date(0) });
};
