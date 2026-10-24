/** Browser DTOs must omit credential material and internal provider identifiers. */
export const FORBIDDEN_KEY = /(token|secret|password|hash|api[_-]?key|credential|(?:vendor|provider).*id)/iu;

// The prefix identifies an owner's public API key without revealing its credential.
// The anti-forgery value must be readable by JavaScript to echo it in a header.
export const KEY_ALLOW_LIST: ReadonlySet<string> = new Set(['apiKeyPrefix', 'csrfToken']);

const PUBLIC_KEY_METADATA_FIELDS = new Set(['id', 'name', 'prefix', 'createdAt', 'lastUsedAt', 'revokedAt', 'scopes']);

/** The key-list wrapper holds metadata objects; a scalar or a raw-key row is still a violation. */
function isPublicKeyMetadata(value: unknown): boolean {
    return Array.isArray(value) && value.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).every((key) => PUBLIC_KEY_METADATA_FIELDS.has(key)));
}

/** Report every offending key with its full response path, including array indices. */
export function findForbiddenKeys(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((child, index) => findForbiddenKeys(child, `${path}[${index}]`));
    }
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => {
        const childPath = `${path}.${key}`;
        // This public boolean describes account state; a string with the same name is rejected.
        const publicValue = KEY_ALLOW_LIST.has(key) || (key === 'mustChangePassword' && typeof child === 'boolean') || (key === 'apiKeys' && isPublicKeyMetadata(child));
        const offences = FORBIDDEN_KEY.test(key) && !publicValue ? [childPath] : [];
        return [...offences, ...findForbiddenKeys(child, childPath)];
    });
}
