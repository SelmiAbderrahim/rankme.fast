/**
 * Fixture redaction.
 *
 * Recorded vendor responses pass through here BEFORE being committed under
 * `shared/testing/fixtures/`: credential-shaped keys are blanked, email
 * addresses replaced with a non-email placeholder, and vendor task ids
 * normalized to `TASK_ID`. The CLI wrapper is `run-redact-fixture.ts`;
 * `shared/testing/fixtures/fixture-lint.ts` is the committed-fixture backstop.
 */
const SECRET_KEY_PATTERN = /^(authorization|.*api[_-]?keys?|password|login|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token)$/i;
/** DataForSEO task ids: 8-4-4-4-12 hex groups. */
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
export interface RedactionResult {
    redacted: unknown;
    redactions: number;
}
export function redactFixture(input: unknown): RedactionResult {
    let redactions = 0;
    function walk(value: unknown, key: string | null): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => walk(item, null));
        }
        if (typeof value === 'object' && value !== null) {
            const entries: [
                string,
                unknown
            ][] = [];
            for (const [k, v] of Object.entries(value)) {
                // Credential-shaped keys are DROPPED entirely — even the key name
                // `authorization` would trip the fixture lint.
                if (SECRET_KEY_PATTERN.test(k)) {
                    redactions += 1;
                    continue;
                }
                entries.push([k, walk(v, k)]);
            }
            return Object.fromEntries(entries);
        }
        if (typeof value === 'string') {
            if (key === 'id' && TASK_ID_PATTERN.test(value)) {
                redactions += 1;
                return 'TASK_ID';
            }
            if (EMAIL_PATTERN.test(value)) {
                redactions += 1;
                // Deliberately NOT email-shaped, so fixture-lint stays clean.
                return value.replace(new RegExp(EMAIL_PATTERN.source, 'g'), 'REDACTED_EMAIL');
            }
        }
        return value;
    }
    return { redacted: walk(input, null), redactions };
}
