/**
 * Injectable holder for the optional AI summary provider.
 *
 * The api process owns the singleton; tests swap in the fake. `null` is a
 * first-class value — it marks "AI summary helper disabled" and the module
 * treats it as a feature-unavailable signal, never a boot-time crash.
 */
import type { SummaryProvider } from '../../shared/providers/index.js';
let currentProvider: SummaryProvider | null = null;
export function setSummaryProvider(provider: SummaryProvider | null): void {
    currentProvider = provider;
}
export function getSummaryProvider(): SummaryProvider | null {
    return currentProvider;
}
