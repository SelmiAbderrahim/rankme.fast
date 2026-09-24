/**
 * Fixture secret lint (prompt 05).
 *
 * Fixtures are recorded vendor responses — they MUST pass through
 * `src/scripts/redact-fixture.ts` before landing here. This lint is the
 * backstop: it fails the suite if any committed fixture still contains an
 * Authorization header, an email address, or a real API-key pattern.
 * `fixture-lint.test.ts` runs it against every committed fixture.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_ROOT } from './load.js';
export interface FixtureSecretPattern {
    name: string;
    pattern: RegExp;
}
export const FIXTURE_SECRET_PATTERNS: FixtureSecretPattern[] = [
    { name: 'authorization header', pattern: /authorization/i },
    // Bound every component: fixtures can contain deliberately oversized
    // attacker text, and an unbounded "scan until @" email pattern turns that
    // security lint into a quadratic ReDoS target.
    {
        name: 'email address',
        pattern: /[a-z\d._%+-]{1,64}@[a-z\d-]{1,63}(?:\.[a-z\d-]{1,63}){1,4}/i,
    },
    { name: 'basic/bearer token', pattern: /\b(basic|bearer)\s+[a-z0-9+/=._-]{8,}/i },
    { name: 'stripe-style api key', pattern: /\b[sprw]k[-_](live|test)[-_]?[a-z0-9]{16,}\b/i },
    { name: 'aws access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'google api key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: 'firecrawl api key', pattern: /\bfc-[0-9A-Za-z_-]{16,}\b/ },
    { name: 'cookie material', pattern: /["']?(?:cookie|set-cookie)["']?\s*:/i },
    {
        name: 'customer prose marker',
        pattern: /\b(?:customer|client|tenant)[-_ ](?:copy|content|prose|text)\b/i,
    },
];
/** Names of the patterns the given text violates (empty = clean). */
export function lintFixtureText(text: string): string[] {
    return FIXTURE_SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
export function listFixtureFiles(dir: string = FIXTURES_ROOT): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFixtureFiles(full));
        }
        else if (entry.name.endsWith('.json')) {
            files.push(full);
        }
    }
    return files;
}
export interface FixtureLintViolation {
    file: string;
    violations: string[];
}
/** Lint every `.json` under the fixtures root (or a given dir). */
export function lintAllFixtures(dir: string = FIXTURES_ROOT): FixtureLintViolation[] {
    const out: FixtureLintViolation[] = [];
    for (const file of listFixtureFiles(dir)) {
        const violations = lintFixtureText(readFileSync(file, 'utf8'));
        if (violations.length > 0) {
            out.push({ file, violations });
        }
    }
    return out;
}
