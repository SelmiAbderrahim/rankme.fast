const INTERNAL_ORIGIN = 'https://internal.rankme.invalid';
const ENCODED_BACKSLASH = /%5c/i;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const PROTOCOL_RELATIVE_PREFIX = /^\/(?:\/|%2f)/i;

function containsControlOrBackslash(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      character === '\\' ||
      code <= 31 ||
      (code >= 127 && code <= 159)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Accept only an origin-relative application path. React Router versions
 * affected by backslash/protocol-relative redirect advisories must never see
 * an API-, markdown-, or user-controlled target before this boundary.
 */
export function safeInternalHref(value: string): string | null {
  if (
    !value.startsWith('/') ||
    PROTOCOL_RELATIVE_PREFIX.test(value) ||
    containsControlOrBackslash(value) ||
    ENCODED_BACKSLASH.test(value) ||
    ENCODED_CONTROL.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
