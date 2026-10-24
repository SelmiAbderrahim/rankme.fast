import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, PDFPage, PDFRawStream, decodePDFRawStream, rgb } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAuditReportPdf } from './report-pdf.service.js';
import { createReportPdfContext, drawReportPdfParagraph, toVisualReportRtlLine } from '../../shared/report-exports/pdf-support.js';

afterEach(() => vi.restoreAllMocks());

describe('embedded PDF glyph rendering', () => {
  it('preserves logical Latin punctuation, signed numbers and parentheses beside Arabic', () => {
    expect(toVisualReportRtlLine('Fix the page title.')).toBe('Fix the page title.');
    expect(toVisualReportRtlLine('عام 2026،')).toContain('2026');
    expect(toVisualReportRtlLine('التغير -75')).toContain('75');
    // Bidi ordering can place the sign on either side of the digits.
    expect(toVisualReportRtlLine('التغير -75')).toContain('-');
    expect(toVisualReportRtlLine('النقرات ٢٧')).toContain('٢٧');
    expect(toVisualReportRtlLine('تطبيق (Saudi cashback app)')).toContain('(Saudi cashback app)');
  });

  it.each(['audit', 'shared'] as const)('%s shapes Arabic numeric glyphs exactly once', async (renderer) => {
    const create = fontkit.create;
    const observed: Array<{ input: string; output: string }> = [];
    vi.spyOn(fontkit, 'create').mockImplementation((...args) => {
      const font = create(...args);
      const layout = font.layout;
      font.layout = function (...parameters) {
        const run = Reflect.apply(layout, font, parameters);
        observed.push({ input: parameters[0], output: run.glyphs.flatMap((glyph: { codePoints: number[] }) => glyph.codePoints).map((point: number) => String.fromCodePoint(point)).join('') });
        return run;
      };
      return font;
    });
    if (renderer === 'audit') {
      await renderAuditReportPdf({ locale: 'ar', report: null, branding: null, generatedAt: new Date('2026-07-06T10:00:00Z'), siteDomain: 'example.test' });
    } else {
      const context = await createReportPdfContext('ar');
      drawReportPdfParagraph(context, 'النقرات 2026', { font: context.regular, size: 12, color: rgb(0, 0, 0), spacingAfter: 4 });
      await context.doc.save();
    }
    const numeric = observed.filter((run) => run.input.includes('2026'));
    expect(numeric.length).toBeGreaterThan(0);
    for (const run of numeric) expect(run.output).toContain('2026');
  });

  it('retains Latin domain glyphs in Arabic audit reports', async () => {
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    await renderAuditReportPdf({ locale: 'ar', report: null, branding: null, generatedAt: new Date('2026-07-06T10:00:00Z'), siteDomain: 'example.test' });
    expect(draw.mock.calls.map(([text]) => text).join('')).toContain('example.test');
  });

  it('embeds visible outlines for Han labels, Latin labels and numeric counts', async () => {
    const context = await createReportPdfContext('zh');
    const encoded = context.regular.encodeText('点击27RankMeFast').asString();
    const document = await PDFDocument.load(await context.doc.save());
    const descriptors = document.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFDict => object instanceof PDFDict && object.has(PDFName.of('FontFile2')));
    expect(descriptors).toHaveLength(1);
    const stream = descriptors[0]!.lookup(PDFName.of('FontFile2'));
    if (!(stream instanceof PDFRawStream)) throw new Error('Missing embedded font program');
    const font = fontkit.create(decodePDFRawStream(stream).decode());
    for (const id of encoded.match(/.{4}/g)!) expect(font.getGlyph(Number.parseInt(id, 16)).path.toSVG().length).toBeGreaterThan(0);
  });

  it('uses the same digit glyphs after Latin and Han labels', async () => {
    const context = await createReportPdfContext('zh');
    const digits = context.regular.encodeText('27').asString();
    expect(context.regular.encodeText('Search Console 点击27').asString()).toMatch(new RegExp(`${digits}$`));
    expect(context.regular.encodeText('点击27').asString()).toMatch(new RegExp(`${digits}$`));
  });
});
