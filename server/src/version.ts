/**
 * Server version, read from package.json at build time. Kept in one place so
 * every consumer (MCP server identity, log fields, health probe) uses the
 * same string and no one hardcodes it. Consumers must NOT invent a value.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
/** Parse only the runtime value we publish; package metadata may be malformed. */
export function packageVersionFromJson(raw: string): string | null {
    const parsed = JSON.parse(raw) as {
        version?: unknown;
    };
    return typeof parsed.version === 'string' && parsed.version.length > 0
        ? parsed.version
        : null;
}
export function firstPackageVersion(candidates: readonly string[], read: (path: string) => string): string {
    for (const path of candidates) {
        try {
            const version = packageVersionFromJson(read(path));
            if (version)
                return version;
        }
        catch {
            /* try next candidate */
        }
    }
    return '0.0.0';
}
const here = dirname(fileURLToPath(import.meta.url));
// Walk up until we find a package.json — dist/ is one level below src/.
export const SERVER_VERSION = firstPackageVersion([resolve(here, '..', 'package.json'), resolve(here, '..', '..', 'package.json')], (path) => readFileSync(path, 'utf8'));
