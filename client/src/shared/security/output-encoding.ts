export const SAFE_EXTERNAL_REL = 'nofollow ugc noopener noreferrer';
export const UNSAFE_HREF_PLACEHOLDER = '#';

/** Serialize typed JSON-LD so script-closing and JS-separator characters stay inert. */
export function serializeJsonLd<T extends Record<string, unknown>>(document: T): string {
  return JSON.stringify(document)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Allow only explicit external-link schemes; invalid/control-character URLs become inert. */
export function safeExternalHref(value: string): string {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  ) {
    return UNSAFE_HREF_PLACEHOLDER;
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : UNSAFE_HREF_PLACEHOLDER;
  } catch {
    return UNSAFE_HREF_PLACEHOLDER;
  }
}
