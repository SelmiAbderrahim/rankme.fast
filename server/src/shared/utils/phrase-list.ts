const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const WRAPPING_QUOTES: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»'], ['「', '」'],
];

function collapse(value: string): string {
    return value.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/** Clean one phrase without splitting commas or removing internal punctuation. */
export function cleanPhrase(phrase: string): string {
    const cleaned = collapse(phrase);
    for (const [open, close] of WRAPPING_QUOTES) {
        if (cleaned.length >= 2 && cleaned.startsWith(open) && cleaned.endsWith(close))
            return collapse(cleaned.slice(open.length, -close.length));
    }
    return cleaned;
}

/** Same comparison form as the client phrase parser: normalized width and case. */
export function phraseKey(phrase: string): string {
    return collapse(cleanPhrase(phrase).normalize('NFKC').toLowerCase());
}
