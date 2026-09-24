/**
 * Bounded evidence excerpt builder.
 *
 * Guarantees:
 *   - Raw HTML markers stripped BEFORE truncation.
 *   - Length ≤ 500 grapheme code points (Unicode-safe truncation).
 *   - Control characters removed (keeps ordinary whitespace).
 *   - `neutralizeExportCell` applied so a re-export (CSV, spreadsheet) cannot
 *     execute a formula.
 *
 * The excerpt is a display artefact — the full text NEVER reaches persistence.
 */
import { neutralizeExportCell } from '../../shared/utils/csv.js';
export const EXCERPT_MAX_LENGTH = 500;
const HTML_TAG_RE = /<[^>]*>/g;
const HTML_ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/g;
function stripControlCharacters(value: string): string {
    return [...value]
        .filter((ch) => {
        const code = ch.charCodeAt(0);
        if (code === 0x09 || code === 0x0a || code === 0x0d)
            return true;
        return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
        .join('');
}
function truncateGraphemes(value: string, max: number): string {
    const glyphs = [...value];
    if (glyphs.length <= max)
        return value;
    return glyphs.slice(0, max).join('');
}
export function buildEvidenceExcerpt(rawText: string): string {
    const withoutTags = rawText.replace(HTML_TAG_RE, ' ');
    const withoutEntities = withoutTags.replace(HTML_ENTITY_RE, ' ');
    const cleaned = stripControlCharacters(withoutEntities).replace(/\s+/g, ' ').trim();
    const truncated = truncateGraphemes(cleaned, EXCERPT_MAX_LENGTH);
    return neutralizeExportCell(truncated);
}
