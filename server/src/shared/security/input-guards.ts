import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../i18n/locales.js';
export { SUPPORTED_LOCALES };
export const SAFE_URL_MAX_LENGTH = 2048;
export const KEYWORD_MAX_LENGTH = 200;
export const NOTE_MAX_LENGTH = 4000;
export const REGEX_INPUT_MAX_LENGTH = 100000;
function stripControlCharacters(value: string): string {
    return [...value]
        .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
        .join('');
}
export const safeUrlString = z
    .string()
    .trim()
    .min(1)
    .max(SAFE_URL_MAX_LENGTH)
    .superRefine((value, context) => {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidUrl' });
        }
    }
    catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.issue.invalidUrl' });
    }
});
export const keywordString = z
    .string()
    .max(KEYWORD_MAX_LENGTH)
    .transform((value) => stripControlCharacters(value).trim())
    .pipe(z.string().min(1).max(KEYWORD_MAX_LENGTH));
export const noteString = z
    .string()
    .max(NOTE_MAX_LENGTH)
    .transform((value) => stripControlCharacters(value).trim())
    .pipe(z.string().max(NOTE_MAX_LENGTH));
export const localeEnum = z.enum(SUPPORTED_LOCALES);
export const boundedPageLimit = z.coerce.number().int().min(1).max(100).default(25);
const CURSOR_VALUE_MAX_LENGTH = 512;
const CURSOR_TOKEN_MAX_LENGTH = 1024;
const cursorPayload = z.object({ version: z.literal(1), value: z.string().min(1).max(CURSOR_VALUE_MAX_LENGTH) }).strict();
export interface PaginationCursorCodec {
    encode(value: string): string;
    decode(token: string): string;
}
function tag(secret: string, value: string): Buffer {
    return createHmac('sha256', secret).update(value).digest();
}
export function createPaginationCursorCodec(secret: string): PaginationCursorCodec {
    if (secret.length < 32)
        throw new Error('cursor secret must be at least 32 characters');
    return {
        encode(value) {
            const payload = Buffer.from(JSON.stringify(cursorPayload.parse({ version: 1, value }))).toString('base64url');
            return `${payload}.${tag(secret, payload).toString('base64url')}`;
        },
        decode(token) {
            if (token.length > CURSOR_TOKEN_MAX_LENGTH)
                throw new Error('invalid pagination cursor');
            const [payload, signature, extra] = token.split('.');
            if (!payload || !signature || extra !== undefined)
                throw new Error('invalid pagination cursor');
            const supplied = Buffer.from(signature, 'base64url');
            const expected = tag(secret, payload);
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                throw new Error('invalid pagination cursor');
            }
            try {
                return cursorPayload.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).value;
            }
            catch {
                throw new Error('invalid pagination cursor');
            }
        },
    };
}
export const paginationCursor = createPaginationCursorCodec(env.BETTER_AUTH_SECRET);
export type QuerySafeValue = string | number | boolean | null | QuerySafeValue[] | {
    [key: string]: QuerySafeValue;
};
export const QUERY_VALUE_MAX_DEPTH = 10;
export const QUERY_VALUE_MAX_NODES = 10000;
export const QUERY_VALUE_MAX_CHILDREN = 1000;
function stripQueryOperatorsInner(value: unknown, depth: number, state: {
    nodes: number;
}): QuerySafeValue {
    state.nodes += 1;
    if (state.nodes > QUERY_VALUE_MAX_NODES)
        throw new Error('query value exceeds node ceiling');
    if (depth > QUERY_VALUE_MAX_DEPTH)
        throw new Error('query value exceeds depth ceiling');
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('query number must be finite');
        return value;
    }
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value)) {
        if (value.length > QUERY_VALUE_MAX_CHILDREN)
            throw new Error('query value exceeds child ceiling');
        return value.map((item) => stripQueryOperatorsInner(item, depth + 1, state));
    }
    if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error('query value must be JSON-like');
    }
    const clean: {
        [key: string]: QuerySafeValue;
    } = {};
    const entries = Object.entries(value);
    if (entries.length > QUERY_VALUE_MAX_CHILDREN)
        throw new Error('query value exceeds child ceiling');
    for (const [key, child] of entries) {
        if (key.startsWith('$') || key.includes('.'))
            continue;
        clean[key] = stripQueryOperatorsInner(child, depth + 1, state);
    }
    return clean;
}
export function stripQueryOperators(value: unknown): QuerySafeValue {
    return stripQueryOperatorsInner(value, 0, { nodes: 0 });
}
/** Run only fixed, reviewed regular expressions after bounding attacker-controlled text. */
export function boundedRegexTest(pattern: RegExp, value: string, maxLength = REGEX_INPUT_MAX_LENGTH): boolean {
    if (!Number.isInteger(maxLength) || maxLength <= 0)
        throw new Error('invalid regex input ceiling');
    pattern.lastIndex = 0;
    return pattern.test(value.slice(0, maxLength));
}
const IDEMPOTENCY_PART = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_KEY = /^idem_[A-Za-z0-9_-]{43}$/;
function assertIdempotencyPart(value: string, name: string): void {
    if (!IDEMPOTENCY_PART.test(value))
        throw new Error(`invalid idempotency ${name}`);
}
export function makeIdempotencyKey(accountId: string, scope: string, clientKey: string): string {
    assertIdempotencyPart(accountId, 'account');
    assertIdempotencyPart(scope, 'scope');
    assertIdempotencyPart(clientKey, 'client key');
    const digest = tag(env.BETTER_AUTH_SECRET, `${accountId}\0${scope}\0${clientKey}`).toString('base64url');
    return `idem_${digest}`;
}
export function assertIdempotencyKey(key: string, accountId: string, scope: string, clientKey: string): void {
    if (!IDEMPOTENCY_KEY.test(key))
        throw new Error('invalid idempotency key');
    const expected = makeIdempotencyKey(accountId, scope, clientKey);
    if (!timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
        throw new Error('idempotency key namespace mismatch');
    }
}
export function canonicalizeCitationId(value: string): string {
    const normalized = value.normalize('NFKC');
    if (normalized !== value || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(normalized)) {
        throw new Error('invalid citation source id');
    }
    return normalized;
}
