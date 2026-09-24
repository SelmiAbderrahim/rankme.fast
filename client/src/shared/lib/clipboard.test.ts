import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeToClipboard } from './clipboard';

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
