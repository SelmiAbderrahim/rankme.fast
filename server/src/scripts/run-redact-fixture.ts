/**
 * CLI wrapper for the fixture redaction logic. Integration seam
 * like run-user-migration.ts — coverage-excluded; the logic it delegates to
 * (`redact-fixture.ts`) is fully covered.
 *
 * Usage: npx tsx src/scripts/run-redact-fixture.ts <fixture.json> [...more]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { redactFixture } from './redact-fixture.js';
const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('usage: tsx src/scripts/run-redact-fixture.ts <fixture.json> [...more]');
    process.exit(1);
}
for (const file of files) {
    const { redacted, redactions } = redactFixture(JSON.parse(readFileSync(file, 'utf8')));
    writeFileSync(file, `${JSON.stringify(redacted, null, 2)}\n`);
    console.log(`${file}: ${redactions} redaction(s)`);
}
