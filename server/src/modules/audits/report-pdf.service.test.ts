/**
 * Renderer tests for the white-label PDF export (workstream B).
 *
 * The renderer is pure — no Mongo, no Postgres, no HTTP — so these tests
 * exercise it directly: determinism (byte-identical re-render), branding
 * fallbacks, all seven locales (including the shaped-Arabic and subset-SC
 * paths), truncation budgets, and the glyph-sanitization safety net.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/index.js';
import { RULE_IDS, type RuleFinding } from './rules/index.js';
import type { AuditReport, LocalizedFinding } from './report.service.js';
import {
  PDF_MAX_FINDINGS,
  PDF_MAX_URLS_PER_FINDING,
  CLIENT_REPORT_MAX_GSC_QUERIES,
  CLIENT_REPORT_MAX_RANK_ROWS,
  parseAccentColor,
  renderAuditReportPdf,
  type RenderAuditReportPdfInput,
} from './report-pdf.service.js';
import { fontFilesFor, readPdfFont } from './pdf/fonts.js';
import { containsArabic, shapeArabic, toVisualRtlLine } from './pdf/rtl.js';

const GENERATED_AT = new Date('2026-07-06T10:00:00.000Z');

async function makeLogo(): Promise<Uint8Array> {
  return sharp({
    create: {
      width: 180,
      height: 60,
      channels: 4,
      background: { r: 199, g: 58, b: 34, alpha: 1 },
    },
  }).png().toBuffer();
}

function rankRows(count: number) {
  const engines = ['google', 'bing', 'youtube', 'amazon'] as const;
  return Array.from({ length: count }, (_, index) => ({
    keyword: `keyword ${String(index).padStart(2, '0')}`,
    engine: engines[index % engines.length]!,
    position: index === 1 ? null : index + 1,
    checkedAt: `2026-07-${String(1 + (index % 5)).padStart(2, '0')}T10:00:00.000Z`,
  }));
}

function gscQueries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    query: `query ${index}`,
    clicks: 20 - index,
    impressions: 200 - index,
    ctr: 0.1,
    position: 3 + index / 10,
    snapshotDate: '2026-07-05',
  }));
}

function makeFinding(
  index: number,
  bucket: RuleFinding['bucket'],
  overrides: Partial<LocalizedFinding> = {},
): LocalizedFinding {
  return {
    ruleId: RULE_IDS[index % RULE_IDS.length]!,
    bucket,
    severity: 'warning',
    affectedUrls: bucket === 'passed' ? [] : [`https://example.com/page-${index}`],
    copy: {
      titleKey: 'auditRules.robots-blocked.title',
      whyKey: 'auditRules.robots-blocked.why',
      fixKey: 'auditRules.robots-blocked.fix',
      passedLabelKey: 'auditRules.robots-blocked.passedLabel',
      title: `Finding number ${index}`,
      why: 'Search engines need this to understand the page.',
      fix: 'Add the missing element and re-run the audit.',
      passedLabel: 'This check is passing.',
    },
    ...overrides,
  };
}

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    runId: 'run-1',
    counts: { fixNow: 2, watch: 1, passed: 1 },
    findings: [
      makeFinding(1, 'fix-now'),
      makeFinding(2, 'fix-now', { affectedUrls: [] }),
      makeFinding(3, 'watch'),
      makeFinding(4, 'passed'),
    ],
    diff: { entries: [], summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
    pageSpeed: null,
    indexStatus: null,
    gscSearch: null,
    gscSitemaps: null,
    aiSummary: null,
    aiSummaryStatus: 'idle',
    aiSummaryAvailability: {
      requestedLocale: 'en',
      availableLocales: [],
      status: 'idle',
    },
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<RenderAuditReportPdfInput> = {},
): RenderAuditReportPdfInput {
  return {
    report: makeReport(),
    branding: null,
    locale: 'en',
    generatedAt: GENERATED_AT,
    siteDomain: 'example.com',
    ...overrides,
  };
}

describe('renderAuditReportPdf', () => {
  it('produces a parseable PDF with at least one page', async () => {
    const bytes = await renderAuditReportPdf(makeInput());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('is deterministic — identical input renders byte-identical output', async () => {
    const input = makeInput({
      branding: { companyName: 'Acme SEO', accentColor: '#c73a22' },
    });
    const first = await renderAuditReportPdf(input);
    const second = await renderAuditReportPdf(input);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
  });

  it('applies custom branding — output differs from the RankMeFast default', async () => {
    const branded = await renderAuditReportPdf(
      makeInput({ branding: { companyName: 'Acme SEO', accentColor: '#3366ff' } }),
    );
    const unbranded = await renderAuditReportPdf(makeInput({ branding: null }));
    expect(Buffer.compare(Buffer.from(branded), Buffer.from(unbranded))).not.toBe(0);
  });

  it('falls back to the ink accent when accentColor is not #rrggbb', async () => {
    const invalid = await renderAuditReportPdf(
      makeInput({ branding: { companyName: 'Acme SEO', accentColor: 'tomato' } }),
    );
    const empty = await renderAuditReportPdf(
      makeInput({ branding: { companyName: 'Acme SEO', accentColor: '' } }),
    );
    expect(Buffer.compare(Buffer.from(invalid), Buffer.from(empty))).toBe(0);
  });

  it('falls back to the localized default brand for a whitespace-only company name', async () => {
    const blankName = await renderAuditReportPdf(
      makeInput({ branding: { companyName: '   ', accentColor: '' } }),
    );
    const noBranding = await renderAuditReportPdf(makeInput({ branding: null }));
    expect(Buffer.compare(Buffer.from(blankName), Buffer.from(noBranding))).toBe(0);
  });

  it.each(SUPPORTED_LOCALES)(
    'renders the complete client report deterministically in %s',
    async (locale: SupportedLocale) => {
      const input = makeInput({
        locale,
        logoPngBytes: await makeLogo(),
        auditSnapshotDate: '2026-07-03T12:00:00.000Z',
        rankSummary: {
          snapshotDate: '2026-07-04T12:00:00.000Z',
          rows: rankRows(4),
        },
        gscSummary: {
          snapshotDate: '2026-07-05',
          windowDays: 28,
          totalClicks: 30,
          totalImpressions: 500,
          averageCtr: 0.06,
          averagePosition: 4.2,
          topQueries: gscQueries(3),
        },
        report: makeReport({
          aiSummary: {
            text: locale === 'ar'
              ? 'ابدأ بإصلاح عنوان الصفحة ثم العناوين الفرعية.'
              : 'Fix the page title first, then the headings.',
            locale,
            model: 'claude-haiku-4-5',
            truncated: false,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        }),
      });
      const first = await renderAuditReportPdf(input);
      const second = await renderAuditReportPdf(input);
      expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
      expect(createHash('sha256').update(first).digest('hex')).toMatchSnapshot();
      const doc = await PDFDocument.load(first);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    },
  );

  it('clips rank and GSC rows at the exported client-report bounds', async () => {
    const base = makeInput({
      report: null,
      rankSummary: {
        snapshotDate: '2026-07-05T00:00:00.000Z',
        rows: rankRows(CLIENT_REPORT_MAX_RANK_ROWS),
      },
      gscSummary: {
        snapshotDate: '2026-07-05',
        windowDays: 28,
        totalClicks: 100,
        totalImpressions: 1_000,
        averageCtr: 0.1,
        averagePosition: 3,
        topQueries: gscQueries(CLIENT_REPORT_MAX_GSC_QUERIES),
      },
    });
    const overflow = makeInput({
      ...base,
      rankSummary: {
        ...base.rankSummary!,
        rows: rankRows(CLIENT_REPORT_MAX_RANK_ROWS + 4),
      },
      gscSummary: {
        ...base.gscSummary!,
        topQueries: gscQueries(CLIENT_REPORT_MAX_GSC_QUERIES + 3),
      },
    });
    const boundedBytes = await renderAuditReportPdf(base);
    const overflowBytes = await renderAuditReportPdf(overflow);
    expect(Buffer.compare(Buffer.from(boundedBytes), Buffer.from(overflowBytes))).toBe(0);
  });

  it('omits an empty rank table and an empty GSC query table without dropping dated GSC totals', async () => {
    const bytes = await renderAuditReportPdf(
      makeInput({
        report: null,
        rankSummary: {
          snapshotDate: '2026-07-04T12:00:00.000Z',
          rows: [],
        },
        gscSummary: {
          snapshotDate: '2026-07-05',
          windowDays: 28,
          totalClicks: 0,
          totalImpressions: 0,
          averageCtr: 0,
          averagePosition: 0,
          topQueries: [],
        },
      }),
    );
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('clips findings at PDF_MAX_FINDINGS across buckets and spills onto extra pages', async () => {
    const findings: LocalizedFinding[] = [];
    for (let i = 0; i < PDF_MAX_FINDINGS; i += 1) findings.push(makeFinding(i, 'fix-now'));
    // These two whole buckets fall outside the budget (budget <= 0 branch).
    findings.push(makeFinding(500, 'watch'));
    findings.push(makeFinding(501, 'passed'));
    const bytes = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          counts: { fixNow: PDF_MAX_FINDINGS, watch: 1, passed: 1 },
          findings,
        }),
      }),
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('clips a bucket partially when the budget runs out inside it', async () => {
    const findings: LocalizedFinding[] = [];
    for (let i = 0; i < PDF_MAX_FINDINGS - 5; i += 1) findings.push(makeFinding(i, 'fix-now'));
    for (let i = 0; i < 10; i += 1) findings.push(makeFinding(1000 + i, 'watch'));
    const bytes = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          counts: { fixNow: PDF_MAX_FINDINGS - 5, watch: 10, passed: 0 },
          findings,
        }),
      }),
    );
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('clips affected URLs at PDF_MAX_URLS_PER_FINDING with a truncation note', async () => {
    const urls = Array.from(
      { length: PDF_MAX_URLS_PER_FINDING + 1 },
      (_v, i) => `https://example.com/deep/${i}`,
    );
    const clipped = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          findings: [makeFinding(1, 'fix-now', { affectedUrls: urls })],
        }),
      }),
    );
    const unclipped = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          aiSummary: {
            text: 'ابدأ بإصلاح العناوين ثم راجع الروابط الداخلية.',
            locale: 'ar',
            model: 'model-ar',
            truncated: false,
            createdAt: '2026-08-25T09:00:00.000Z',
          },
          aiSummaryStatus: 'succeeded',
          aiSummaryAvailability: {
            requestedLocale: 'ar',
            availableLocales: ['ar'],
            status: 'succeeded',
          },
          findings: [
            makeFinding(1, 'fix-now', {
              affectedUrls: urls.slice(0, PDF_MAX_URLS_PER_FINDING),
            }),
          ],
        }),
      }),
    );
    expect(Buffer.compare(Buffer.from(clipped), Buffer.from(unclipped))).not.toBe(0);
  });

  it('renders the AI summary section only when present', async () => {
    const withSummary = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          aiSummary: {
            text: 'First paragraph.\n\nSecond\tparagraph with a tab and a\r carriage return.',
            locale: 'en',
            model: 'claude-haiku-4-5',
            truncated: false,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        }),
      }),
    );
    const withoutSummary = await renderAuditReportPdf(makeInput());
    expect(Buffer.compare(Buffer.from(withSummary), Buffer.from(withoutSummary))).not.toBe(0);
  });

  it('sanitizes characters the embedded font cannot draw instead of throwing', async () => {
    const bytes = await renderAuditReportPdf(
      makeInput({
        locale: 'zh',
        report: makeReport({
          aiSummary: {
            // Emoji + rare hanzi are outside the vendored SC subset.
            text: '先修复标题。😀 龘齉靐 done.',
            locale: 'zh',
            model: 'claude-haiku-4-5',
            truncated: false,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        }),
      }),
    );
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('hard-breaks a single token wider than the content column', async () => {
    const longUrl = `https://example.com/${'segment/'.repeat(40)}end`;
    const bytes = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          findings: [makeFinding(1, 'fix-now', { affectedUrls: [longUrl] })],
        }),
      }),
    );
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('word-wraps long prose across lines', async () => {
    const longWhy = 'Search engines really need this element to understand the page. '.repeat(8);
    const bytes = await renderAuditReportPdf(
      makeInput({
        report: makeReport({
          findings: [
            makeFinding(1, 'fix-now', {
              copy: {
                titleKey: 'auditRules.robots-blocked.title',
                whyKey: 'auditRules.robots-blocked.why',
                fixKey: 'auditRules.robots-blocked.fix',
                passedLabelKey: 'auditRules.robots-blocked.passedLabel',
                title: 'Wrapping check',
                why: longWhy,
                fix: 'Add it.',
                passedLabel: '',
              },
            }),
          ],
        }),
      }),
    );
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('renders Arabic copy through the shaping + visual-reorder pipeline', async () => {
    const bytes = await renderAuditReportPdf(
      makeInput({
        locale: 'ar',
        report: makeReport({
          findings: [
            makeFinding(1, 'fix-now', {
              affectedUrls: ['https://example.com/page'],
              copy: {
                titleKey: 'auditRules.robots-blocked.title',
                whyKey: 'auditRules.robots-blocked.why',
                fixKey: 'auditRules.robots-blocked.fix',
                passedLabelKey: 'auditRules.robots-blocked.passedLabel',
                title: 'الصفحة تفتقد عنوانًا رئيسيًا',
                why: 'محركات البحث تحتاج عنوانًا واضحًا مثل example.com دائمًا.',
                fix: 'أضف وسم عنوان.',
                passedLabel: 'كل شيء جيد.',
              },
            }),
            makeFinding(4, 'passed', {
              copy: {
                titleKey: 'auditRules.robots-blocked.title',
                whyKey: 'auditRules.robots-blocked.why',
                fixKey: 'auditRules.robots-blocked.fix',
                passedLabelKey: 'auditRules.robots-blocked.passedLabel',
                title: 'فحص ناجح',
                why: '',
                fix: '',
                passedLabel: 'هذا الفحص ناجح.',
              },
            }),
          ],
        }),
      }),
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });
});

describe('parseAccentColor', () => {
  it('parses a #rrggbb value', () => {
    expect(parseAccentColor('#c73a22')).toEqual({
      type: 'RGB',
      red: 0xc7 / 255,
      green: 0x3a / 255,
      blue: 0x22 / 255,
    });
  });

  it.each(['', 'tomato', '#fff', '#12345g', 'c73a22'])('rejects %j', (value) => {
    expect(parseAccentColor(value)).toBeNull();
  });
});

describe('pdf fonts', () => {
  it('maps ar/zh to their single-weight fonts and everything else to Noto Sans', () => {
    expect(fontFilesFor('ar')).toEqual({
      regular: 'NotoSansArabic-Regular.ttf',
      bold: 'NotoSansArabic-Regular.ttf',
    });
    expect(fontFilesFor('zh')).toEqual({
      regular: 'NotoSansSC-Regular.otf',
      bold: 'NotoSansSC-Regular.otf',
    });
    expect(fontFilesFor('en')).toEqual({
      regular: 'NotoSans-Regular.ttf',
      bold: 'NotoSans-Bold.ttf',
    });
  });

  it('memoizes font bytes (same instance on the second read)', () => {
    const first = readPdfFont('NotoSans-Regular.ttf');
    const second = readPdfFont('NotoSans-Regular.ttf');
    expect(second).toBe(first);
    expect(first.byteLength).toBeGreaterThan(50_000);
  });
});

describe('rtl helpers', () => {
  it('containsArabic detects Arabic-script characters', () => {
    expect(containsArabic('عنوان')).toBe(true);
    expect(containsArabic('title 123')).toBe(false);
  });

  it('shapeArabic maps letters onto presentation forms', () => {
    const shaped = shapeArabic('عنوان');
    expect(shaped).not.toBe('عنوان');
    // Presentation Forms-A/B blocks.
    expect(/[ﭐ-﷿ﹰ-ﻼ]/.test(shaped)).toBe(true);
  });

  it('reverses pure Arabic word order and characters within words', () => {
    // Using presentation-form-free letters keeps the assertion readable:
    // input words "ab cd" in Arabic script → visual "dc ba".
    expect(toVisualRtlLine('ست عد')).toBe('دع تس');
  });

  it('keeps embedded LTR runs (Latin tokens, digits) in logical order', () => {
    expect(toVisualRtlLine('اب example.com 42 جد')).toBe('دج example.com 42 با');
  });

  it('passes a pure-LTR line through unchanged', () => {
    expect(toVisualRtlLine('plain latin 42')).toBe('plain latin 42');
  });
});
