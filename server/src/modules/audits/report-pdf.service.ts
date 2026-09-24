/**
 * White-label PDF renderer for audit reports (workstream B).
 *
 * Pure and deterministic: identical input (including `generatedAt`) yields
 * byte-identical output — creation/modification dates are injected, fonts
 * are embedded with fixed `customName`s (pdf-lib would otherwise add a
 * random subset suffix), and no other entropy enters the document.
 *
 * Locale handling:
 *   - en/fr/de/es/ru → Noto Sans (regular + bold).
 *   - zh → Noto Sans SC subset, single weight, character-level word wrap.
 *     Characters outside the vendored subset (rare hanzi in AI summaries)
 *     are replaced with `?` instead of throwing.
 *   - ar → Noto Sans Arabic, single weight. pdf-lib does no shaping/bidi, so
 *     text is shaped onto Arabic Presentation Forms and reordered to visual
 *     RTL per line (see `./pdf/rtl.ts` for the full decision record). Dates
 *     use Latin digits (`ar-u-nu-latn`) so numbers survive reordering.
 *
 * The layout is a simple top-down cursor with manual page breaks: header
 * (brand + accent rule), site + generated-at lines, bucket counts, findings
 * grouped fix-now → watch → passed (clipped at PDF_MAX_FINDINGS, ten URLs
 * per finding), optional AI summary, and a localized page-number footer.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { translate, type SupportedLocale, type TranslationVars, } from '../../shared/i18n/index.js';
import type { AuditReport, LocalizedFinding } from './report.service.js';
import { fontFilesFor, readPdfFont } from './pdf/fonts.js';
import { containsArabic, shapeArabic, toVisualRtlLine } from './pdf/rtl.js';
export interface ReportPdfBranding {
    companyName: string;
    /** `'#rrggbb'` or `''` — anything else falls back to the ink default. */
    accentColor: string;
}
export interface RenderAuditReportPdfInput {
    /** Localized report (copy already resolved) from `./report.service.js`. */
    report: AuditReport | null;
    /** `null` → the localized RankMeFast default header. */
    branding: ReportPdfBranding | null;
    locale: SupportedLocale;
    /** Injected so identical input renders byte-identical output. */
    generatedAt: Date;
    siteDomain: string;
    /** Persisted, server-reencoded PNG bytes only. */
    logoPngBytes?: Uint8Array | null;
    /** Stored audit snapshot date; required by the client-report composer. */
    auditSnapshotDate?: string | null;
    rankSummary?: ReportPdfRankSummary | null;
    gscSummary?: ReportPdfGscSummary | null;
}
export const PDF_MAX_FINDINGS = 200;
export const PDF_MAX_URLS_PER_FINDING = 10;
export const CLIENT_REPORT_MAX_RANK_ROWS = 25;
export const CLIENT_REPORT_MAX_GSC_QUERIES = 5;
export const CLIENT_REPORT_MAX_LOGO_WIDTH_PT = 96;
export const CLIENT_REPORT_MAX_LOGO_HEIGHT_PT = 36;
export interface ReportPdfRankRow {
    keyword: string;
    engine: 'google' | 'bing' | 'youtube' | 'amazon';
    position: number | null;
    checkedAt: string;
}
export interface ReportPdfRankSummary {
    snapshotDate: string;
    rows: readonly ReportPdfRankRow[];
}
export interface ReportPdfGscQuery {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    snapshotDate: string;
}
export interface ReportPdfGscSummary {
    snapshotDate: string;
    windowDays: 28;
    totalClicks: number;
    totalImpressions: number;
    averageCtr: number;
    averagePosition: number;
    topQueries: readonly ReportPdfGscQuery[];
}
const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const FOOTER_SPACE = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// Aria editorial palette (design-system rule): ink primary, warm-gray muted.
const INK = rgb(28 / 255, 26 / 255, 24 / 255);
const BODY = rgb(25 / 255, 23 / 255, 21 / 255);
const MUTED = rgb(107 / 255, 102 / 255, 96 / 255);
const HEX_ACCENT = /^#[0-9a-fA-F]{6}$/;
/** Parse a `#rrggbb` accent into a pdf-lib color; `null` on anything else. */
export function parseAccentColor(value: string): RGB | null {
    if (!HEX_ACCENT.test(value))
        return null;
    return rgb(Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255);
}
interface RenderCtx {
    doc: PDFDocument;
    page: PDFPage;
    y: number;
    rtl: boolean;
    zh: boolean;
    regular: PDFFont;
    bold: PDFFont;
    glyphs: Map<PDFFont, Set<number>>;
}
function addPage(ctx: RenderCtx): void {
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = PAGE_HEIGHT - MARGIN;
}
function ensureSpace(ctx: RenderCtx, height: number): void {
    if (ctx.y - height < MARGIN + FOOTER_SPACE)
        addPage(ctx);
}
function glyphSetFor(ctx: RenderCtx, font: PDFFont): Set<number> {
    const cached = ctx.glyphs.get(font);
    if (cached)
        return cached;
    const set = new Set(font.getCharacterSet());
    ctx.glyphs.set(font, set);
    return set;
}
/**
 * Replace characters the embedded font has no glyph for with `?` so neither
 * width measurement nor drawing can throw (AI summaries and crawled URLs are
 * arbitrary text). Tabs/CR collapse to spaces; newlines are handled by the
 * paragraph splitter before this runs.
 */
function sanitizeForFont(ctx: RenderCtx, font: PDFFont, text: string): string {
    const glyphs = glyphSetFor(ctx, font);
    let out = '';
    for (const ch of text) {
        const codePoint = ch.codePointAt(0) as number;
        if (codePoint === 0x09 || codePoint === 0x0d) {
            out += ' ';
            continue;
        }
        out += glyphs.has(codePoint) ? ch : '?';
    }
    return out;
}
/** Shape (ar) + sanitize one logical-order paragraph for a font. */
function prepareText(ctx: RenderCtx, font: PDFFont, text: string): string {
    const shaped = ctx.rtl && containsArabic(text) ? shapeArabic(text) : text;
    return sanitizeForFont(ctx, font, shaped);
}
/**
 * Greedy word wrap (character wrap for zh). Over-long single tokens — URLs,
 * unbroken CJK-free strings — are hard-broken at character boundaries.
 */
function wrapText(ctx: RenderCtx, font: PDFFont, size: number, text: string, maxWidth: number): string[] {
    const tokens = ctx.zh ? [...text] : text.split(' ').filter((token) => token.length > 0);
    const separator = ctx.zh ? '' : ' ';
    const width = (value: string): number => font.widthOfTextAtSize(value, size);
    const lines: string[] = [];
    let current = '';
    const flush = (): void => {
        if (current.length > 0) {
            lines.push(current);
            current = '';
        }
    };
    for (const token of tokens) {
        const candidate = current.length > 0 ? current + separator + token : token;
        if (width(candidate) <= maxWidth) {
            current = candidate;
            continue;
        }
        flush();
        if (width(token) <= maxWidth) {
            current = token;
            continue;
        }
        let chunk = '';
        for (const ch of token) {
            if (chunk.length > 0 && width(chunk + ch) > maxWidth) {
                lines.push(chunk);
                chunk = ch;
            }
            else {
                chunk += ch;
            }
        }
        current = chunk;
    }
    flush();
    return lines;
}
interface ParagraphOptions {
    font: PDFFont;
    size: number;
    color: RGB;
    indent?: number;
    spacingAfter: number;
}
/** Draw a (possibly multi-line, possibly multi-paragraph) block of text. */
function drawParagraph(ctx: RenderCtx, rawText: string, options: ParagraphOptions): void {
    const { font, size, color } = options;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.4;
    const maxWidth = CONTENT_WIDTH - indent;
    for (const paragraph of rawText.split('\n')) {
        const prepared = prepareText(ctx, font, paragraph);
        for (const line of wrapText(ctx, font, size, prepared, maxWidth)) {
            ensureSpace(ctx, lineHeight);
            const visual = ctx.rtl ? toVisualRtlLine(line) : line;
            const x = ctx.rtl
                ? PAGE_WIDTH - MARGIN - indent - font.widthOfTextAtSize(visual, size)
                : MARGIN + indent;
            ctx.page.drawText(visual, { x, y: ctx.y - size, size, font, color });
            ctx.y -= lineHeight;
        }
    }
    ctx.y -= options.spacingAfter;
}
function drawFinding(ctx: RenderCtx, finding: LocalizedFinding, t: (key: string, vars?: TranslationVars) => string): void {
    drawParagraph(ctx, finding.copy.title, {
        font: ctx.bold,
        size: 11,
        color: BODY,
        spacingAfter: 2,
    });
    if (finding.bucket === 'passed') {
        drawParagraph(ctx, finding.copy.passedLabel, {
            font: ctx.regular,
            size: 10,
            color: MUTED,
            spacingAfter: 10,
        });
        return;
    }
    drawParagraph(ctx, finding.copy.why, {
        font: ctx.regular,
        size: 10,
        color: BODY,
        spacingAfter: 2,
    });
    const hasUrls = finding.affectedUrls.length > 0;
    drawParagraph(ctx, finding.copy.fix, {
        font: ctx.regular,
        size: 10,
        color: BODY,
        spacingAfter: hasUrls ? 4 : 10,
    });
    if (!hasUrls)
        return;
    drawParagraph(ctx, t('affectedUrls'), {
        font: ctx.regular,
        size: 9,
        color: MUTED,
        spacingAfter: 1,
    });
    const urls = finding.affectedUrls.slice(0, PDF_MAX_URLS_PER_FINDING);
    for (const url of urls) {
        drawParagraph(ctx, url, {
            font: ctx.regular,
            size: 9,
            color: MUTED,
            indent: 12,
            spacingAfter: 1,
        });
    }
    const clippedUrls = finding.affectedUrls.length - urls.length;
    if (clippedUrls > 0) {
        drawParagraph(ctx, t('truncatedNote', { count: clippedUrls }), {
            font: ctx.regular,
            size: 9,
            color: MUTED,
            indent: 12,
            spacingAfter: 1,
        });
    }
    ctx.y -= 9;
}
function formatStoredDate(locale: SupportedLocale, value: string): string {
    const dateLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale;
    return new Intl.DateTimeFormat(dateLocale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
    }).format(new Date(value));
}
function formatDecimal(locale: SupportedLocale, value: number, maximumFractionDigits = 1): string {
    const numberLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale;
    return new Intl.NumberFormat(numberLocale, { maximumFractionDigits }).format(value);
}
async function drawBrandHeader(ctx: RenderCtx, brandName: string, logoPngBytes: Uint8Array | null | undefined): Promise<void> {
    if (!logoPngBytes || logoPngBytes.length === 0) {
        drawParagraph(ctx, brandName, { font: ctx.bold, size: 20, color: INK, spacingAfter: 6 });
        return;
    }
    const logo = await ctx.doc.embedPng(logoPngBytes);
    const scale = Math.min(1, CLIENT_REPORT_MAX_LOGO_WIDTH_PT / logo.width, CLIENT_REPORT_MAX_LOGO_HEIGHT_PT / logo.height);
    const logoWidth = logo.width * scale;
    const logoHeight = logo.height * scale;
    const gap = 12;
    const textWidth = CONTENT_WIDTH - logoWidth - gap;
    const prepared = prepareText(ctx, ctx.bold, brandName);
    const lines = wrapText(ctx, ctx.bold, 20, prepared, textWidth).slice(0, 2);
    const lineHeight = 28;
    const blockHeight = Math.max(logoHeight, lines.length * lineHeight);
    ensureSpace(ctx, blockHeight + 6);
    const logoX = ctx.rtl ? PAGE_WIDTH - MARGIN - logoWidth : MARGIN;
    ctx.page.drawImage(logo, {
        x: logoX,
        y: ctx.y - logoHeight,
        width: logoWidth,
        height: logoHeight,
    });
    lines.forEach((line, index) => {
        const visual = ctx.rtl ? toVisualRtlLine(line) : line;
        const x = ctx.rtl
            ? logoX - gap - ctx.bold.widthOfTextAtSize(visual, 20)
            : MARGIN + logoWidth + gap;
        ctx.page.drawText(visual, {
            x,
            y: ctx.y - 20 - index * lineHeight,
            size: 20,
            font: ctx.bold,
            color: INK,
        });
    });
    ctx.y -= blockHeight + 6;
}
function drawRankSummary(ctx: RenderCtx, summary: ReportPdfRankSummary, locale: SupportedLocale, t: (key: string, vars?: TranslationVars) => string, accent: RGB): void {
    const rows = summary.rows.slice(0, CLIENT_REPORT_MAX_RANK_ROWS);
    if (rows.length === 0)
        return;
    const sectionDate = formatStoredDate(locale, summary.snapshotDate);
    drawParagraph(ctx, t('rankSummary'), {
        font: ctx.bold,
        size: 13,
        color: accent,
        spacingAfter: 3,
    });
    drawParagraph(ctx, t('snapshotDate', { date: sectionDate }), {
        font: ctx.regular,
        size: 9,
        color: MUTED,
        spacingAfter: 6,
    });
    for (const row of rows) {
        const checkedAt = formatStoredDate(locale, row.checkedAt);
        const position = row.position === null
            ? t('notRanked')
            : formatDecimal(locale, row.position, 0);
        drawParagraph(ctx, t('rankRow', {
            keyword: row.keyword,
            engine: t(`engines.${row.engine}`),
            position,
            date: checkedAt,
        }), { font: ctx.regular, size: 10, color: BODY, indent: 8, spacingAfter: 3 });
    }
    ctx.y -= 7;
}
function drawGscSummary(ctx: RenderCtx, summary: ReportPdfGscSummary, locale: SupportedLocale, t: (key: string, vars?: TranslationVars) => string, accent: RGB): void {
    const sectionDate = formatStoredDate(locale, summary.snapshotDate);
    drawParagraph(ctx, t('gscSummary', { days: summary.windowDays }), {
        font: ctx.bold,
        size: 13,
        color: accent,
        spacingAfter: 3,
    });
    drawParagraph(ctx, t('snapshotDate', { date: sectionDate }), {
        font: ctx.regular,
        size: 9,
        color: MUTED,
        spacingAfter: 5,
    });
    drawParagraph(ctx, t('gscTotals', {
        clicks: formatDecimal(locale, summary.totalClicks, 0),
        impressions: formatDecimal(locale, summary.totalImpressions, 0),
        ctr: formatDecimal(locale, summary.averageCtr * 100, 1),
        position: formatDecimal(locale, summary.averagePosition, 1),
        date: sectionDate,
    }), { font: ctx.regular, size: 10, color: BODY, spacingAfter: 6 });
    const queries = summary.topQueries.slice(0, CLIENT_REPORT_MAX_GSC_QUERIES);
    if (queries.length > 0) {
        drawParagraph(ctx, t('topQueries'), {
            font: ctx.bold,
            size: 10,
            color: BODY,
            spacingAfter: 3,
        });
        for (const query of queries) {
            drawParagraph(ctx, t('gscQueryRow', {
                query: query.query,
                clicks: formatDecimal(locale, query.clicks, 0),
                impressions: formatDecimal(locale, query.impressions, 0),
                ctr: formatDecimal(locale, query.ctr * 100, 1),
                position: formatDecimal(locale, query.position, 1),
                date: formatStoredDate(locale, query.snapshotDate),
            }), { font: ctx.regular, size: 9, color: BODY, indent: 8, spacingAfter: 3 });
        }
    }
    ctx.y -= 7;
}
const BUCKET_ORDER = [
    { bucket: 'fix-now', labelKey: 'fixNow' },
    { bucket: 'watch', labelKey: 'watch' },
    { bucket: 'passed', labelKey: 'passed' },
] as const;
async function renderAuditReportPdfWithSharedPrimitives(input: RenderAuditReportPdfInput): Promise<Uint8Array> {
    const { report, branding, locale, generatedAt, siteDomain } = input;
    const t = (key: string, vars?: TranslationVars): string => translate(locale, `report.pdf.${key}`, vars);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const files = fontFilesFor(locale);
    const regular = await doc.embedFont(readPdfFont(files.regular), {
        subset: true,
        customName: 'RankMeFast-Regular',
    });
    const bold = files.bold === files.regular
        ? regular
        : await doc.embedFont(readPdfFont(files.bold), {
            subset: true,
            customName: 'RankMeFast-Bold',
        });
    // Deterministic metadata — no wall-clock, no randomness.
    doc.setTitle(t('title'));
    doc.setProducer('RankMeFast');
    doc.setCreator('RankMeFast');
    doc.setCreationDate(generatedAt);
    doc.setModificationDate(generatedAt);
    const ctx: RenderCtx = {
        doc,
        // Placeholders — addPage() immediately assigns the real first page.
        page: undefined as unknown as PDFPage,
        y: 0,
        rtl: locale === 'ar',
        zh: locale === 'zh',
        regular,
        bold,
        glyphs: new Map(),
    };
    addPage(ctx);
    const accent = branding ? (parseAccentColor(branding.accentColor) ?? INK) : INK;
    const trimmedCompanyName = branding ? branding.companyName.trim() : '';
    const brandName = trimmedCompanyName.length > 0 ? trimmedCompanyName : t('defaultBrand');
    // Header: optional normalized logo + brand name + accent rule.
    await drawBrandHeader(ctx, brandName, input.logoPngBytes);
    ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - 3,
        width: CONTENT_WIDTH,
        height: 3,
        color: accent,
    });
    ctx.y -= 17;
    // Meta block.
    drawParagraph(ctx, t('title'), { font: bold, size: 15, color: BODY, spacingAfter: 4 });
    drawParagraph(ctx, t('site', { domain: siteDomain }), {
        font: regular,
        size: 10,
        color: MUTED,
        spacingAfter: 2,
    });
    // UTC keeps output independent of the server timezone; Latin digits for ar
    // keep numbers out of the character-reversal path.
    const dateLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale;
    const formattedDate = new Intl.DateTimeFormat(dateLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(generatedAt);
    drawParagraph(ctx, t('generatedAt', { date: formattedDate }), {
        font: regular,
        size: 10,
        color: MUTED,
        spacingAfter: 12,
    });
    if (input.auditSnapshotDate) {
        drawParagraph(ctx, t('auditSnapshotDate', {
            date: formatStoredDate(locale, input.auditSnapshotDate),
        }), {
            font: regular,
            size: 9,
            color: MUTED,
            spacingAfter: 7,
        });
    }
    if (report) {
        // Bucket counts summary.
        const summaryLine = `${t('fixNow')}: ${report.counts.fixNow}    ${t('watch')}: ${report.counts.watch}    ${t('passed')}: ${report.counts.passed}`;
        drawParagraph(ctx, summaryLine, { font: bold, size: 11, color: BODY, spacingAfter: 14 });
        // Findings grouped fix-now → watch → passed with a GLOBAL findings budget.
        let drawn = 0;
        let clippedFindings = 0;
        for (const { bucket, labelKey } of BUCKET_ORDER) {
            const findings = report.findings.filter((finding) => finding.bucket === bucket);
            if (findings.length === 0)
                continue;
            const budget = PDF_MAX_FINDINGS - drawn;
            if (budget <= 0) {
                clippedFindings += findings.length;
                continue;
            }
            drawParagraph(ctx, t(labelKey), { font: bold, size: 13, color: accent, spacingAfter: 6 });
            const toDraw = findings.slice(0, budget);
            clippedFindings += findings.length - toDraw.length;
            for (const finding of toDraw) {
                drawFinding(ctx, finding, t);
                drawn += 1;
            }
        }
        if (clippedFindings > 0) {
            drawParagraph(ctx, t('truncatedNote', { count: clippedFindings }), {
                font: regular,
                size: 10,
                color: MUTED,
                spacingAfter: 10,
            });
        }
        // Optional AI summary.
        if (report.aiSummary) {
            drawParagraph(ctx, t('aiSummary'), { font: bold, size: 13, color: accent, spacingAfter: 6 });
            drawParagraph(ctx, report.aiSummary.text, {
                font: regular,
                size: 10,
                color: BODY,
                spacingAfter: 10,
            });
        }
    }
    if (input.rankSummary) {
        drawRankSummary(ctx, input.rankSummary, locale, t, accent);
    }
    if (input.gscSummary) {
        drawGscSummary(ctx, input.gscSummary, locale, t, accent);
    }
    // Page-number footers (drawn last so the total is known).
    const pages = doc.getPages();
    pages.forEach((page, index) => {
        const prepared = prepareText(ctx, regular, t('page', { n: index + 1, total: pages.length }));
        const text = ctx.rtl ? toVisualRtlLine(prepared) : prepared;
        page.drawText(text, {
            x: (PAGE_WIDTH - regular.widthOfTextAtSize(text, 9)) / 2,
            y: MARGIN / 2,
            size: 9,
            font: regular,
            color: MUTED,
        });
    });
    return doc.save();
}
/**
 * Byte-compatible legacy façade. Unified reports use the canonical block
 * renderer; audit/client-report routes keep their pinned composition while
 * sharing the same font loading and Arabic shaping primitives underneath.
 */
export async function renderAuditReportPdf(input: RenderAuditReportPdfInput): Promise<Uint8Array> {
    return renderAuditReportPdfWithSharedPrimitives(input);
}
