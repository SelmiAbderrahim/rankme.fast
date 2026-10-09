/**
 * Output guard for the AI "Summarize my fixes" text.
 *
 * Models sometimes narrate their own input ("No fix-now findings were
 * supplied", "even though it lists no pages") instead of speaking to the
 * site owner. The prompts forbid it, but a prompt is not a guarantee, so the
 * finished text is checked here. A leaking summary is replaced by a
 * deterministic one built from the localized finding titles: no extra paid
 * retry, and the owner still gets a useful, truthful answer.
 */
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { translate } from '../../shared/i18n/index.js';
import type { SummaryFindingInput } from '../../shared/providers/index.js';

/** Stored in place of a model id when the deterministic text was used. */
export const DETERMINISTIC_SUMMARY_MODEL = 'deterministic';

/** At most this many findings are named per group in the fallback text. */
const MAX_NAMED_PER_GROUP = 3;

/**
 * Phrases that describe the request payload rather than the site, per
 * locale. Deliberately narrow: each pattern needs the "data was handed to
 * me" shape so ordinary advice ("provided your site uses HTTPS") passes.
 */
const LEAK_PATTERNS: Readonly<Record<SupportedLocale, readonly RegExp[]>> = {
    en: [
        /\bsupplied\b/i,
        /\b(?:findings?|items?|data|input|list|pages?)\s+(?:was|were|is|are)\s+(?:not\s+)?(?:provided|given|listed|included)\b/i,
        /\blists?\s+no\s+pages?\b/i,
        /\bno\s+(?:affected\s+)?pages\s+(?:are|were)\s+listed\b/i,
        /\b(?:empty|missing)\s+(?:findings\s+)?list\b/i,
        /\blist\s+(?:was|is)\s+(?:empty|missing)\b/i,
    ],
    fr: [
        /\b(?:n['’]ont|n['’]a)\s+pas\s+été\s+(?:fournis?e?s?|transmis(?:es?)?|list[ée]e?s?)\b/i,
        /\b(?:fournis|fournies)\s+(?:ci-dessus|dans la liste)\b/i,
        /\bne\s+(?:liste|répertorie)\s+aucune\s+page\b/i,
    ],
    de: [
        /\b(?:wurde|wurden)\s+(?:keine?\s+)?\w*\s*(?:bereitgestellt|übermittelt|geliefert|aufgeführt)\b/i,
        /\bführt\s+keine\s+seiten\s+auf\b/i,
    ],
    es: [
        /\bno\s+se\s+(?:han\s+)?(?:proporcionado|suministrado|facilitado|incluido)\b/i,
        /\b(?:proporcionad[oa]s?|suministrad[oa]s?)\s+en\s+la\s+lista\b/i,
        /\bno\s+(?:enumera|lista)\s+(?:ninguna\s+)?p[áa]ginas?\b/i,
    ],
    ru: [
        /(?<!\p{L})не\s+был[аио]?\s+(?:предоставлен|переда)\p{L}*/iu,
        /(?<!\p{L})не\s+(?:указывает|перечисляет)\s+страниц/iu,
    ],
    zh: [/未提供/u, /没有提供/u, /所提供的/u, /未列出(?:任何)?页面/u],
    ar: [/لم\s+يتم\s+(?:تقديم|توفير)/u, /(?:المُقدَّمة|المقدمة)\s+لي/u],
};

/** True when the text talks about its input payload instead of the site. */
export function leaksPromptWording(text: string, locale: SupportedLocale): boolean {
    return LEAK_PATTERNS[locale].some((pattern) => pattern.test(text));
}

function nameFindings(locale: SupportedLocale, findings: readonly SummaryFindingInput[]): string {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(findings.slice(0, MAX_NAMED_PER_GROUP).map((finding) => finding.title));
}

/**
 * Plain-language summary built only from the localized finding titles.
 * Fix-now findings come first; with none, it says nothing is urgent.
 */
export function buildDeterministicSummary(locale: SupportedLocale, findings: readonly SummaryFindingInput[]): string {
    const urgent = findings.filter((finding) => finding.priority !== 'watch');
    const watch = findings.filter((finding) => finding.priority === 'watch');
    const parts: string[] = [];
    if (urgent.length > 0) {
        parts.push(translate(locale, 'audits.aiSummary.fallback.urgent', { items: nameFindings(locale, urgent) }));
    }
    else if (watch.length > 0) {
        parts.push(translate(locale, 'audits.aiSummary.fallback.nothingUrgent'));
    }
    if (watch.length > 0) {
        parts.push(translate(locale, 'audits.aiSummary.fallback.watch', { items: nameFindings(locale, watch) }));
    }
    if (parts.length === 0) {
        parts.push(translate(locale, 'audits.aiSummary.fallback.none'));
    }
    return parts.join(' ');
}
