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
