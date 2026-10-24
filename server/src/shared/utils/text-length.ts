export type LanguageClass = 'spaced' | 'ideographic' | 'hangul' | 'thai';
export type TextLengthUnit = 'words' | 'characters';

const IDEOGRAPHIC_LANGUAGES: ReadonlySet<string> = new Set(['zh', 'ja', 'yue', 'wuu', 'cmn']);
const HANGUL_LANGUAGES: ReadonlySet<string> = new Set(['ko']);
const THAI_LANGUAGES: ReadonlySet<string> = new Set(['th', 'lo', 'km', 'my']);

export function primaryLanguage(tag: string | null | undefined): string | null {
    if (typeof tag !== 'string')
        return null;
    const match = /^([a-z]{2,3})(?:[-_]|$)/.exec(tag.trim().toLowerCase());
    return match ? match[1]! : null;
}

export function languageClassOf(lang: string | null | undefined): LanguageClass {
    const primary = primaryLanguage(lang);
    if (primary === null)
        return 'spaced';
    if (IDEOGRAPHIC_LANGUAGES.has(primary))
        return 'ideographic';
    if (HANGUL_LANGUAGES.has(primary))
        return 'hangul';
    if (THAI_LANGUAGES.has(primary))
        return 'thai';
    return 'spaced';
}

const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const THAI = /\p{Script=Thai}/u;
const LETTER = /\p{L}/u;

/** Identify an unspaced script when it accounts for at least one third of the letters. */
export function detectLanguage(text: string): string | null {
    let letters = 0;
    let han = 0;
    let kana = 0;
    let hangul = 0;
    let thai = 0;
    for (const character of text) {
        if (!LETTER.test(character))
            continue;
        letters += 1;
        if (KANA.test(character))
            kana += 1;
        if (HAN_OR_KANA.test(character))
            han += 1;
        else if (HANGUL.test(character))
            hangul += 1;
        else if (THAI.test(character))
            thai += 1;
    }
    if (letters === 0)
        return null;
    const substantial = (count: number): boolean => count / letters >= 1 / 3;
    if (substantial(han))
        return kana > 0 ? 'ja' : 'zh';
    if (substantial(hangul))
        return 'ko';
    if (substantial(thai))
        return 'th';
    return null;
}

const HTML_ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
const segmenters = new Map<string, Intl.Segmenter>();

function wordSegmenter(lang: string): Intl.Segmenter {
    let segmenter = segmenters.get(lang);
    if (!segmenter) {
        segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
        segmenters.set(lang, segmenter);
    }
    return segmenter;
}

function segmenterLanguage(text: string, lang: string | null | undefined): string {
    const primary = primaryLanguage(lang) ?? detectLanguage(text);
    if (primary === null)
        return 'en';
    return Intl.Segmenter.supportedLocalesOf([primary]).length > 0 ? primary : 'en';
}

/** Count language-aware words rather than whitespace, excluding entities and punctuation. */
export function countWords(text: string, lang?: string | null): number {
    const clean = text.replace(HTML_ENTITY, ' ');
    if (clean.trim().length === 0)
        return 0;
    let count = 0;
    for (const segment of wordSegmenter(segmenterLanguage(clean, lang)).segment(clean)) {
        if (segment.isWordLike)
            count += 1;
    }
    return count;
}

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function graphemes(text: string): string[] {
    return Array.from(graphemeSegmenter.segment(text), part => part.segment);
}

export function countCharacters(text: string): number {
    return graphemes(text.replace(HTML_ENTITY, ' ').replace(/\s+/gu, '')).length;
}

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
/** Approximate Latin-character display width, with wide characters counting twice. */
export function displayWidth(text: string): number {
    return graphemes(text).reduce((width, grapheme) => width + (WIDE.test(grapheme) ? 2 : 1), 0);
}

export interface TextMeasure {
    value: number;
    unit: TextLengthUnit;
}
export function measureText(text: string, lang?: string | null): TextMeasure {
    const languageClass = languageClassOf(primaryLanguage(lang) ?? detectLanguage(text));
    return languageClass === 'spaced'
        ? { value: countWords(text, lang), unit: 'words' }
        : { value: countCharacters(text), unit: 'characters' };
}
