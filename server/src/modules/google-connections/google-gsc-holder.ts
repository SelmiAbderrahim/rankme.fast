/**
 * Injectable GscProvider holder.
 *
 * The api process wires ONE GoogleGscProvider at boot when GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET are present. Feature routes read it through this
 * setter/getter (mirrors `setAuditsQueue` / `setAuth`) so tests inject a
 * fake without hand-rolling OAuth roundtrips.
 */
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
let currentProvider: GoogleGscProvider | null = null;
export function setGoogleGscProvider(provider: GoogleGscProvider | null): void {
    currentProvider = provider;
}
export function getGoogleGscProvider(): GoogleGscProvider | null {
    return currentProvider;
}
