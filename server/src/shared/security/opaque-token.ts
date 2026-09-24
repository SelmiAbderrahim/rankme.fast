import { createHash, randomBytes } from 'node:crypto';
/** Shared strength for public bearer links: 256 bits before base64url encoding. */
export const OPAQUE_BEARER_TOKEN_BYTES = 32;
export const OPAQUE_BEARER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export function createOpaqueBearerToken(): string {
    return randomBytes(OPAQUE_BEARER_TOKEN_BYTES).toString('base64url');
}
export function hashOpaqueBearerToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
export function isOpaqueBearerToken(token: string): boolean {
    return OPAQUE_BEARER_TOKEN_PATTERN.test(token);
}
