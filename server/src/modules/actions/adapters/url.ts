import { ACTION_MAX_AFFECTED_URLS } from '../actions.orders.js';
// Shared affected-URL canonicalizer for the source adapters. There is no
// repo-wide URL canonicalize helper outside the vendor layer (checked
// `shared/` — the closest is the DataForSEO discovery normalizer, which is
// provider-private), so the actions module owns this small pure one:
//   - WHATWG-parse; anything unparseable (rule keys, site-wide markers) is
//     dropped rather than surfaced broken;
//   - http(s) only — no javascript:/data:/file: schemes ever reach a client;
//   - fragments and embedded credentials stripped;
//   - order-preserving dedupe, bounded to ACTION_MAX_AFFECTED_URLS.
export function canonicalizeAffectedUrls(urls: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urls) {
        let parsed: URL;
        try {
            parsed = new URL(raw);
        }
        catch {
            continue;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            continue;
        parsed.hash = '';
        parsed.username = '';
        parsed.password = '';
        const canonical = parsed.toString();
        if (seen.has(canonical))
            continue;
        seen.add(canonical);
        out.push(canonical);
        if (out.length >= ACTION_MAX_AFFECTED_URLS)
            break;
    }
    return out;
}
