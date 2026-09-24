import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadInternalLinkCsv } from './csv';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadInternalLinkCsv', () => {
  it('downloads already-BOM-prefixed server text and revokes the URL', () => {
    const create = vi.fn(() => 'blob:internal-links');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(downloadInternalLinkCsv('links.csv', "\ufeffanchor\r\n'=SUM(1)\r\n")).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:internal-links');
    expect(document.querySelector('a[download="links.csv"]')).toBeNull();
  });

  it('restores the BOM consumed by the fetch text decoder', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:internal-links');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(downloadInternalLinkCsv('links.csv', "anchor\r\n'=SUM(1)\r\n")).toBe(true);
    const blob = create.mock.calls[0]?.[0] as Blob;
    const downloadedBytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsArrayBuffer(blob);
    });
    expect([...downloadedBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('returns false when the browser download API or document is unavailable', () => {
    const original = URL.createObjectURL;
    URL.createObjectURL = undefined as never;
    expect(downloadInternalLinkCsv('links.csv', 'x')).toBe(false);
    URL.createObjectURL = original;
    vi.stubGlobal('document', undefined);
    expect(downloadInternalLinkCsv('links.csv', 'x')).toBe(false);
  });
});
