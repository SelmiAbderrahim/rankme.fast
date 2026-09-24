import { Buffer } from 'node:buffer';
export const DISAVOW_MAX_URL_CHARS = 2048;
export const DISAVOW_MAX_LINES = 100000;
export const DISAVOW_MAX_BYTES = 2 * 1024 * 1024;
export type DisavowEntry = {
    kind: 'domain';
    value: string;
} | {
    kind: 'url';
    value: string;
};
export interface SerializeDisavowInput {
    rubricVersion: string;
    generatedOn: Date;
    entries: readonly DisavowEntry[];
}
export class DisavowSerializationError extends Error {
    constructor() {
        super('invalid_disavow_entry');
        this.name = 'DisavowSerializationError';
    }
}
const FORMULA_PREFIX = /^[=+\-@]/u;
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;
function containsUnsafeText(value: string): boolean {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0)!;
        return (codePoint <= 0x1f ||
            (codePoint >= 0x7f && codePoint <= 0x9f) ||
            (codePoint >= 0x2028 && codePoint <= 0x202e) ||
            (codePoint >= 0x2066 && codePoint <= 0x2069));
    });
}
function rejectUnsafe(value: string): void {
    if (value.length === 0 ||
        value !== value.trim() ||
        containsUnsafeText(value) ||
        FORMULA_PREFIX.test(value)) {
        throw new DisavowSerializationError();
    }
}
export function canonicalizeDisavowDomain(raw: string): string {
    rejectUnsafe(raw);
    if (raw.includes('/') || raw.includes(':') || raw.includes('@')) {
        throw new DisavowSerializationError();
    }
    let hostname: string;
    try {
        const parsed = new URL(`http://${raw}`);
        hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    }
    catch {
        throw new DisavowSerializationError();
    }
    if (hostname.length === 0 ||
        hostname.length > 253 ||
        !hostname.includes('.') ||
        !hostname.split('.').every((label) => HOST_LABEL.test(label))) {
        throw new DisavowSerializationError();
    }
    return hostname;
}
export function canonicalizeDisavowUrl(raw: string): string {
    rejectUnsafe(raw);
    if (raw.length > DISAVOW_MAX_URL_CHARS)
        throw new DisavowSerializationError();
    let parsed: URL;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new DisavowSerializationError();
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username.length > 0 ||
        parsed.password.length > 0 ||
        parsed.hostname.length === 0) {
        throw new DisavowSerializationError();
    }
    parsed.hash = '';
    const canonical = parsed.toString();
    if (canonical.length > DISAVOW_MAX_URL_CHARS ||
        containsUnsafeText(canonical)) {
        throw new DisavowSerializationError();
    }
    return canonical;
}
function fixedComments(rubricVersion: string, generatedOn: Date): string[] {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(rubricVersion)) {
        throw new DisavowSerializationError();
    }
    if (Number.isNaN(generatedOn.getTime()))
        throw new DisavowSerializationError();
    return [
        '# RankMeFast link review export',
        `# rubric: ${rubricVersion}`,
        `# generated: ${generatedOn.toISOString().slice(0, 10)}`,
    ];
}
/** Pure, stable Google disavow text serializer. It performs no I/O. */
export function serializeDisavow(input: SerializeDisavowInput): string {
    const entries = new Map<string, {
        kind: 'domain' | 'url';
        value: string;
    }>();
    for (const entry of input.entries) {
        const value = entry.kind === 'domain'
            ? canonicalizeDisavowDomain(entry.value)
            : canonicalizeDisavowUrl(entry.value);
        entries.set(`${entry.kind}\0${value}`, { kind: entry.kind, value });
    }
    const directives = [...entries.values()]
        .sort((a, b) => {
        if (a.kind !== b.kind)
            return a.kind === 'domain' ? -1 : 1;
        // Equal values have already been removed by the keyed Map above.
        return a.value < b.value ? -1 : 1;
    })
        .map((entry) => entry.kind === 'domain' ? `domain:${entry.value}` : entry.value);
    const lines = [
        ...fixedComments(input.rubricVersion, input.generatedOn),
        ...directives,
    ];
    if (lines.length > DISAVOW_MAX_LINES)
        throw new DisavowSerializationError();
    const output = `${lines.join('\n')}\n`;
    if (Buffer.byteLength(output, 'utf8') > DISAVOW_MAX_BYTES) {
        throw new DisavowSerializationError();
    }
    return output;
}
