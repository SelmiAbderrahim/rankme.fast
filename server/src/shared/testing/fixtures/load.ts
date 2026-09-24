/**
 * Recorded-fixture loader (prompt 05).
 *
 * Convention: `fixtures/<provider>/<operation>/<case>.json` where `case` is
 * one of `success`, `timeout`, `malformed`, `quota`, plus operation-specific
 * extras (e.g. `in-queue`, `unavailable`).
 *
 * - `<case>.json` — the RECORDED vendor response body, stored verbatim after
 *   passing through `src/scripts/redact-fixture.ts` (credentials stripped,
 *   task ids normalized to TASK_ID).
 * - `<case>.meta.json` — optional sidecar: `{ "status": 503 }` for non-200
 *   HTTP cases, `{ "timeout": true }` for the meta-only timeout marker (no
 *   body file — the vendor never answered).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const FIXTURES_ROOT = dirname(fileURLToPath(import.meta.url));
interface FixtureMeta {
    timeout?: boolean;
    status?: number;
}
export interface LoadedFixture {
    /** `true` = meta-only marker: the mock must hang past the client timeout. */
    timeout: boolean;
    /** HTTP status to serve. 0 for timeout fixtures (never sent). */
    status: number;
    /** Parsed response body. `null` for timeout fixtures. */
    body: unknown;
}
export function loadFixture(provider: string, operation: string, kase: string): LoadedFixture {
    const base = join(FIXTURES_ROOT, provider, operation, kase);
    const metaPath = `${base}.meta.json`;
    const meta: FixtureMeta = existsSync(metaPath)
        ? (JSON.parse(readFileSync(metaPath, 'utf8')) as FixtureMeta)
        : {};
    if (meta.timeout === true) {
        return { timeout: true, status: 0, body: null };
    }
    const body: unknown = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    return { timeout: false, status: meta.status ?? 200, body };
}
