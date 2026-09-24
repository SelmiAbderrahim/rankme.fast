/**
 * Safe JSON-LD serialization for server-emitted structured data.
 *
 *
 * The encoding table mirrors the shipped client discipline in
 * `client/src/shared/security/output-encoding.ts`, so one payload stays inert
 * both inside an inline `<script>` block and inside a downloaded `.jsonld`
 * file. `JSON.stringify` leaves `<`, `>`, `&`, U+2028 and U+2029 raw; the first
 * three close a script element and the last two terminate a JavaScript string
 * literal. All five become six-character `\uXXXX` escapes here.
 *
 * No other module may build JSON-LD by string concatenation — the repository
 * grep test in `json-ld.test.ts` fails the suite on any such attempt.
 */
/** Media type for inline `<script>` blocks and JSON-LD downloads. */
export const JSON_LD_MEDIA_TYPE = 'application/ld+json';
/** Hard ceiling for the escaped payload retained or downloaded (SEC-BOUND). */
export const MAX_JSON_LD_PAYLOAD_BYTES = 128 * 1024;
/** Serialize a JSON-LD document so script-closing and JS-separator code points stay inert. */
export function serializeJsonLd<T extends Record<string, unknown>>(document: T): string {
    const payload = JSON.stringify(document)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    if (Buffer.byteLength(payload, 'utf8') > MAX_JSON_LD_PAYLOAD_BYTES) {
        throw new RangeError('serialized JSON-LD exceeds the payload ceiling');
    }
    return payload;
}
