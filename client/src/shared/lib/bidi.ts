/** Directional isolates for user content in markup and plain-text labels. */
const FSI = '\u2068';
const PDI = '\u2069';
const LRI = '\u2066';
const RLI = '\u2067';
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const WORD = /\p{L}[\p{L}\p{M}]*/gu;

export function isolateText(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/** Count words so a leading Latin brand does not override an Arabic title. */
export function dominantDirection(text: string): 'rtl' | 'ltr' | 'auto' {
  const words = text.match(WORD) ?? [];
  if (words.length === 0) return 'auto';
  const rtl = words.filter((word) => RTL_LETTER.test(word)).length;
  return rtl > 0 && rtl >= words.length - rtl ? 'rtl' : 'ltr';
}

export function isolateDominant(text: string): string {
  const direction = dominantDirection(text);
  if (direction === 'rtl') return `${RLI}${text}${PDI}`;
  if (direction === 'ltr') return `${LRI}${text}${PDI}`;
  return isolateText(text);
}

/** Keep date/number sequences in a fixed order inside an RTL interface. */
export function isolateLtr(text: string): string {
  return `${LRI}${text.replace(/[\u200e\u200f\u061c]/g, '')}${PDI}`;
}
