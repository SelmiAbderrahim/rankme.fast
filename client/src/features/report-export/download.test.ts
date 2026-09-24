import { afterEach, describe, expect, it, vi } from 'vitest';
import { filenameFromContentDisposition, saveBlobAs } from './download';
import { reportExportErrorMessage } from './errorMapping';
import { ApiError } from '@shared/api/client';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report-export client output safety', () => {
  it.each([
    [null, 'fallback.pdf', 'fallback.pdf'],
    ["attachment; filename*=UTF-8''rapport-%C3%A9t%C3%A9.pdf", 'x', 'rapport-été.pdf'],
    ["attachment; filename*=UTF-8''%E0%A4%A; filename=ascii.pdf", 'x', 'ascii.pdf'],
    ['attachment; filename="quoted\\"name.pdf"', 'x', 'quoted-name.pdf'],
    ['attachment; filename=plain.csv', 'x', 'plain.csv'],
    ['attachment', '../unsafe/fallback?.txt', 'fallback-.txt'],
    ['attachment; filename="../path/evil\r\n?.pdf"', 'x', 'evil-.pdf'],
    ['attachment; filename=\u0000', '...', 'rankmefast-report'],
  ] as const)('derives an inert local filename from %s', (header, fallback, expected) => {
    expect(filenameFromContentDisposition(header, fallback)).toBe(expected);
  });

  it('creates, clicks, removes, and revokes one object URL', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const append = vi.spyOn(document.body, 'appendChild');
    saveBlobAs(new Blob(['stored']), '../unsafe/report?.pdf');
    expect(create).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        href: 'blob:report',
        download: 'report-.pdf',
      }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[href="blob:report"]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:report');
  });

  it('maps only trusted API error envelopes and otherwise uses localized fallback copy', () => {
    expect(
      reportExportErrorMessage(
        new ApiError('raw', 400, { error: { message: 'Localized nested' } }),
        'Fallback',
      ),
    ).toBe('Localized nested');
    expect(
      reportExportErrorMessage(new ApiError('raw', 400, { error: 'Localized string' }), 'Fallback'),
    ).toBe('Localized string');
    for (const value of [
      new Error('raw'),
      new ApiError('raw', 400, null),
      new ApiError('raw', 400, { error: { message: 1 } }),
      // A raw translation key or an unresolved placeholder is never copy.
      new ApiError('raw', 404, { error: { message: 'reportExports.errors.notFound' } }),
      new ApiError('raw', 429, { error: 'Try again in {{seconds}} seconds.' }),
    ]) {
      expect(reportExportErrorMessage(value, 'Fallback')).toBe('Fallback');
    }
  });
});
