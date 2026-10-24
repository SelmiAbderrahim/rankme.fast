import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeLazyTextToClipboard, writeToClipboard } from './clipboard';

const stubClipboard = (value: unknown) => {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  });
});

describe('writeToClipboard', () => {
  it('writes to the async clipboard API and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const ok = await writeToClipboard('hello');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports failure when the clipboard API is missing', async () => {
    stubClipboard(undefined);
    expect(await writeToClipboard('hello')).toBe(false);
  });

  it('reports failure when the clipboard write is rejected', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    expect(await writeToClipboard('hello')).toBe(false);
  });

  it('reports failure in a server-side environment', async () => {
    vi.stubGlobal('window', undefined);
    expect(await writeToClipboard('hello')).toBe(false);
  });
});

describe('loading text for the clipboard', () => {
  it('starts a deferred clipboard write during the click before text is loaded', async () => {
    let resolveText!: (text: string) => void;
    const text = new Promise<string>((resolve) => { resolveText = resolve; });
    let content!: Record<string, Promise<Blob>>;
    class PendingClipboardItem {
      constructor(data: Record<string, Promise<Blob>>) { content = data; }
    }
    vi.stubGlobal('ClipboardItem', PendingClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write });
    const result = writeLazyTextToClipboard(() => text);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0][0]).toBeInstanceOf(PendingClipboardItem);
    resolveText('all filtered keywords');
    const blob = await content['text/plain']!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe('all filtered keywords'.length);
    expect(await result).toBe(true);
  });

  it('falls back to writeText and reports loading and permission failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    expect(await writeLazyTextToClipboard(async () => 'loaded')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('loaded');
    expect(await writeLazyTextToClipboard(async () => { throw new Error('load failed'); })).toBe(false);
    writeText.mockRejectedValue(new Error('denied'));
    expect(await writeLazyTextToClipboard(async () => 'loaded')).toBe(false);
    vi.stubGlobal('ClipboardItem', class {});
    writeText.mockResolvedValue(undefined);
    expect(await writeLazyTextToClipboard(async () => 'no rich clipboard')).toBe(true);
  });

  it('returns false without a browser clipboard and never loads unnecessarily', async () => {
    const load = vi.fn().mockResolvedValue('unused');
    stubClipboard(undefined);
    expect(await writeLazyTextToClipboard(load)).toBe(false);
    vi.stubGlobal('window', undefined);
    expect(await writeLazyTextToClipboard(load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
});
