import { createHash } from 'node:crypto';
function canonicalNumber(value: number): string {
    if (!Number.isFinite(value))
        throw new Error('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
}
/** RFC 8785-compatible serializer for the bounded JSON values used by reports. */
export function canonicalLandscapeJson(value: unknown): string {
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number')
        return canonicalNumber(value);
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalLandscapeJson(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalLandscapeJson(record[key])}`)
            .join(',')}}`;
    }
    throw new Error(`canonical JSON rejects ${typeof value}`);
}
export function sha256CanonicalLandscape(value: unknown): string {
    return createHash('sha256').update(canonicalLandscapeJson(value), 'utf8').digest('hex');
}
function lengthPrefix(bytes: Buffer): Buffer {
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64BE(BigInt(bytes.length));
    return Buffer.concat([prefix, bytes]);
}
/** Manifest first, then pages in canonical page-index order. */
export function landscapeContentHash(manifest: unknown, pages: readonly unknown[]): string {
    const hash = createHash('sha256');
    for (const segment of [manifest, ...pages]) {
        hash.update(lengthPrefix(Buffer.from(canonicalLandscapeJson(segment), 'utf8')));
    }
    return hash.digest('hex');
}
