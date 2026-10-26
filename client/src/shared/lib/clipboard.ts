/**
 * Copy text to the system clipboard.
 *
 * Isolated in its own module so tests can `vi.mock()` it without wrestling
 * with jsdom's non-configurable `navigator.clipboard` getter. It lives in
 * `shared/` because more than one feature needs it (the report's fix hint and
 * the schema generator's JSON-LD payload); `features/report/clipboard.ts`
 * re-exports this single implementation.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const clipboard = window.navigator?.clipboard;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Start the write during the user gesture while its text is still loading. */
export async function writeLazyTextToClipboard(load: () => Promise<string>): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const clipboard = window.navigator?.clipboard;
  if (!clipboard) return false;
  try {
    if (typeof window.ClipboardItem === 'function' && typeof clipboard.write === 'function') {
      const blob = load().then((text) => new Blob([text], { type: 'text/plain' }));
      await clipboard.write([new window.ClipboardItem({ 'text/plain': blob })]);
    } else {
      await clipboard.writeText(await load());
    }
    return true;
  } catch {
    return false;
  }
}
