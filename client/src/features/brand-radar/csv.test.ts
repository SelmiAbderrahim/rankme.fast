import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_RADAR_MENTION_CSV_COLUMNS,
  brandRadarCapturedAt,
  brandRadarCsvFilename,
  buildBrandRadarMentionCsv,
  downloadBrandRadarCsv,
} from './csv';
import { mentionFixture, scanDetailFixture } from './__fixtures__/scans';

const header = () => BRAND_RADAR_MENTION_CSV_COLUMNS.map((column) => column.header);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('brand-radar mention CSV', () => {
  it('emits the frozen column order', () => {
    expect(header()).toEqual([
      'scan_id',
      'captured_at',
      'brand_query',
      'mention_url',
      'domain',
      'title',
      'snippet',
      'sentiment',
      'observed_at',
    ]);
    const csv = buildBrandRadarMentionCsv(scanDetailFixture(), []);
    expect(csv.split('\r\n')[0]).toContain('scan_id,captured_at,brand_query');
  });

  it('stamps captured_at from terminalAt, falling back to createdAt', () => {
    expect(
      brandRadarCapturedAt(
        scanDetailFixture({
          createdAt: '2026-07-20T10:00:00.000Z',
          terminalAt: '2026-07-20T10:05:00.000Z',
        }),
      ),
    ).toBe('2026-07-20T10:05:00.000Z');
    expect(
      brandRadarCapturedAt(
        scanDetailFixture({ createdAt: '2026-07-20T10:00:00.000Z', terminalAt: null }),
      ),
    ).toBe('2026-07-20T10:00:00.000Z');
  });

  it('neutralizes every formula prefix, CRLF, script and RTL-override payload', () => {
    const csv = buildBrandRadarMentionCsv(scanDetailFixture(), [
      mentionFixture({ id: 'm1', title: '=SUM(1)' }),
      mentionFixture({ id: 'm2', title: '+1' }),
      mentionFixture({ id: 'm3', title: '-1' }),
      mentionFixture({ id: 'm4', title: '@x' }),
      mentionFixture({ id: 'm5', snippet: 'line one\r\nline two' }),
      mentionFixture({ id: 'm6', snippet: '<script>alert(1)</script>' }),
      mentionFixture({ id: 'm7', domain: '‮evil.example' }),
    ]);

    expect(csv).toContain("'=SUM(1)");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@x");
    // A CRLF payload survives only inside RFC-4180 quoting.
    expect(csv).toContain('"line one\r\nline two"');
    // The script payload is inert text in a CSV cell — nothing is stripped.
    expect(csv).toContain('<script>alert(1)</script>');
    expect(csv).toContain('‮evil.example');
    // No raw formula start survives at a cell boundary.
    expect(csv).not.toMatch(/(^|,)=SUM/);
  });

  it('exports a rejected URL as an empty cell and keeps an http(s) one', () => {
    const csv = buildBrandRadarMentionCsv(scanDetailFixture(), [
      mentionFixture({
        id: 'm1',
        url: null,
        domain: 'blocked.example',
        observedAt: null,
      }),
      mentionFixture({ id: 'm2', url: 'https://ok.example/post', domain: 'ok.example' }),
    ]);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[1]).toContain(',,blocked.example,');
    // An undated row exports an empty observed_at rather than a made-up date.
    expect(rows[1]?.endsWith(',positive,')).toBe(true);
    expect(rows[2]).toContain('https://ok.example/post');
  });

  it('names the file after the scan', () => {
    expect(brandRadarCsvFilename(scanDetailFixture())).toBe(
      'brand-radar-mentions-65f000000000000000000001.csv',
    );
  });

  it('downloads through a blob url and cleans it up', () => {
    const createObjectURL = vi.fn(() => 'blob:brand-radar');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    expect(downloadBrandRadarCsv('mentions.csv', 'a,b\r\n')).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:brand-radar');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('is a no-op where the runtime has no object-url support', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });
    expect(downloadBrandRadarCsv('mentions.csv', 'a,b\r\n')).toBe(false);
  });
});
