export type KeywordScript = 'arabic' | 'cyrillic' | 'han' | 'kana' | 'hangul' | 'latin' | 'other';
const SCRIPT_PATTERNS: ReadonlyArray<readonly [KeywordScript, RegExp]> = [
  ['arabic', /\p{Script=Arabic}/gu],
  ['cyrillic', /\p{Script=Cyrillic}/gu],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['hangul', /\p{Script=Hangul}/gu],
  ['han', /\p{Script=Han}/gu],
  ['latin', /\p{Script=Latin}/gu],
];

/** Count letters only; digits and punctuation do not identify a language. */
export function dominantScript(text: string): KeywordScript {
  const letters = text.match(/\p{L}/gu)?.join('') ?? '';
  let best: KeywordScript = 'other';
  let bestCount = 0;
  for (const [script, pattern] of SCRIPT_PATTERNS) {
    const count = letters.match(pattern)?.length ?? 0;
    if (count > bestCount) { best = script; bestCount = count; }
  }
  return best;
}

const SCRIPT_LANGUAGES = {
  arabic: ['ar', 'fa', 'ur'], cyrillic: ['ru', 'uk', 'bg', 'sr', 'kk'],
  han: ['zh', 'ja'], kana: ['ja'], hangul: ['ko'],
} as const;
export interface ScriptMismatch {
  script: Exclude<KeywordScript, 'latin' | 'other'>;
  suggested: string;
  offered: boolean;
}

/** Advisory only: a deliberate cross-language keyword remains valid. */
export function scriptMismatch(text: string, languageCode: string, offeredLanguages: readonly string[] = []): ScriptMismatch | null {
  const script = dominantScript(text);
  if (script === 'latin' || script === 'other') return null;
  const languages: readonly string[] = SCRIPT_LANGUAGES[script];
  if (languages.includes(languageCode)) return null;
  const offered = languages.find((language) => offeredLanguages.includes(language));
  return { script, suggested: offered ?? SCRIPT_LANGUAGES[script][0], offered: offered !== undefined };
}
