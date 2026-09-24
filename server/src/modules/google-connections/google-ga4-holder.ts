/**
 * Injectable Ga4Provider holder.
 *
 * The api process wires ONE Ga4Provider at boot when GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET are present (same guard as the GSC provider — the two
 * capabilities share the Google OAuth client). Feature routes read it through
 * this setter/getter (mirrors `setGoogleGscProvider`) so tests inject a fake.
 */
import type { Ga4Provider } from '../../shared/providers/types.js';
let currentProvider: Ga4Provider | null = null;
export function setGoogleGa4Provider(provider: Ga4Provider | null): void {
    currentProvider = provider;
}
export function getGoogleGa4Provider(): Ga4Provider | null {
    return currentProvider;
}
