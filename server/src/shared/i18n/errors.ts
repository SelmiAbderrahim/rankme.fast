/**
 * Typed, localized error primitives shared by every server error surface
 * (Express `HttpError`, Zod validation, rate limiters, body-parser faults and
 * the generic 500 path).
 *
 * Three invariants hold everywhere these helpers are used:
 *
 * 1. **Nothing raw leaks.** A message the dictionary cannot resolve fails
 *    closed to the localized status-family copy — never the literal text a
 *    caller passed, never the translation key, never an unresolved
 *    `{{placeholder}}`.
 * 2. **Interpolation is bounded.** Only short named scalars survive
 *    `sanitizeTranslationVars`; identifiers, credentials, vendor prose and
 *    arbitrary request input are rejected before they can reach a response.
 * 3. **Metadata is stable.** Every localized error carries a machine `code`
 *    and the `messageKey` it rendered from, so clients and logs can key off a
 *    value that does not move when the copy changes.
 */
import type { ZodError, ZodIssue } from 'zod';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from './locales.js';
import { DICTIONARIES, translate, type DictionaryShape, type TranslationVars } from './index.js';
/**
 * Every dot-path in the English dictionary whose leaf is a string. Nested
 * objects recurse; anything else (arrays, functions) contributes nothing, so a
 * `TranslationKey` is always renderable.
 */
type StringLeafPaths<T, Prefix extends string = ''> = {
    [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : T[K] extends readonly unknown[] ? never : T[K] extends object ? StringLeafPaths<T[K], `${Prefix}${K}.`> : never;
}[keyof T & string];
export type TranslationKey = StringLeafPaths<DictionaryShape>;
/**
 * Localized error descriptor. `code` and `messageKey` are the stable machine
 * contract; `vars` is bounded interpolation input; `details` is the existing
 * compatibility payload; `cause` stays internal and is NEVER serialized into a
 * response or a log message.
 */
export interface LocalizedErrorDescriptor {
    code: string;
    messageKey: TranslationKey;
    vars?: TranslationVars;
    details?: unknown;
    cause?: unknown;
}
/** Response metadata for one localized error. */
export interface LocalizedErrorPayload {
    code: string;
    messageKey: string;
    message: string;
}
const PLACEHOLDER = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g;
const KEY_SHAPE = /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/;
const VAR_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
// eslint-disable-next-line no-control-regex -- deliberately rejects C0/C1 control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const VALID_CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/;
const FORBIDDEN_VAR_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_VARS = 16;
const MAX_VAR_LENGTH = 200;
const MAX_CODE_LENGTH = 96;
/**
 * Bound interpolation to named scalars. Anything else — nested objects,
 * arrays, functions, symbols, `null`, non-finite numbers, oversized strings,
 * control characters, prototype-polluting names — is dropped rather than
 * rendered, so a caller cannot smuggle identifiers, credentials, vendor text
 * or raw request input into a user-visible message.
 */
export function sanitizeTranslationVars(vars: unknown): TranslationVars | undefined {
    if (vars === null || typeof vars !== 'object' || Array.isArray(vars))
        return undefined;
    const out: TranslationVars = {};
    let accepted = 0;
    for (const [name, value] of Object.entries(vars as Record<string, unknown>)) {
        if (accepted >= MAX_VARS)
            break;
        if (!VAR_NAME.test(name) || FORBIDDEN_VAR_NAMES.has(name))
            continue;
        if (typeof value === 'string') {
            if (value.length === 0 || value.length > MAX_VAR_LENGTH)
                continue;
            if (CONTROL_CHARS.test(value))
                continue;
            out[name] = value;
            accepted += 1;
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            out[name] = value;
            accepted += 1;
        }
    }
    return accepted === 0 ? undefined : out;
}
/** `ranks.errors.checkCooldown` → `RANKS_ERRORS_CHECK_COOLDOWN`. */
export function deriveErrorCode(key: string): string {
    const upper = key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[.\-\s]/g, '_')
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    return upper.length === 0 ? 'ERROR' : upper.slice(0, MAX_CODE_LENGTH);
}
export interface StatusFamily {
    code: string;
    messageKey: TranslationKey;
}
const BAD_REQUEST_FAMILY: StatusFamily = { code: 'BAD_REQUEST', messageKey: 'errors.badRequest' };
const INTERNAL_FAMILY: StatusFamily = { code: 'INTERNAL', messageKey: 'errors.internal' };
const STATUS_FAMILIES: Readonly<Record<string, StatusFamily>> = Object.freeze({
    400: BAD_REQUEST_FAMILY,
    401: { code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' },
    402: { code: 'PAYMENT_REQUIRED', messageKey: 'errors.paymentRequired' },
    403: { code: 'FORBIDDEN', messageKey: 'errors.forbidden' },
    404: { code: 'NOT_FOUND', messageKey: 'errors.notFound' },
    409: { code: 'CONFLICT', messageKey: 'errors.conflict' },
    422: { code: 'VALIDATION_FAILED', messageKey: 'errors.validationFailed' },
    429: { code: 'TOO_MANY_REQUESTS', messageKey: 'errors.tooManyRequests' },
    503: { code: 'SERVICE_UNAVAILABLE', messageKey: 'errors.serviceUnavailable' },
});
/** Safe copy for a status when no specific dictionary key resolved. */
export function statusFamily(status: number): StatusFamily {
    const exact = STATUS_FAMILIES[String(status)];
    if (exact)
        return exact;
    return status >= 400 && status < 500 ? BAD_REQUEST_FAMILY : INTERNAL_FAMILY;
}
/** True when the value resolves to a string leaf of the English dictionary. */
export function hasTranslationKey(key: unknown): key is TranslationKey {
    if (typeof key !== 'string' || !KEY_SHAPE.test(key))
        return false;
    // Dictionary leaves are only strings or nested objects (never null), so a
    // plain `typeof` walk is enough — an overshoot lands on a string and stops.
    let cursor: unknown = DICTIONARIES[DEFAULT_LOCALE];
    for (const segment of key.split('.')) {
        if (typeof cursor !== 'object')
            return false;
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return typeof cursor === 'string';
}
/** Normalize an arbitrary value onto a supported locale. */
export function toSupportedLocale(value: unknown): SupportedLocale {
    return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
/**
 * Render one dictionary key. Interpolation always runs, so a placeholder with
 * no accepted variable collapses to nothing instead of shipping `{{metric}}`
 * to a customer; the leftover whitespace is tidied afterwards.
 */
export function renderTranslation(locale: SupportedLocale, key: TranslationKey, vars?: TranslationVars): string {
    return translate(locale, key, vars ?? {})
        .replace(PLACEHOLDER, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
export interface ResolveLocalizedErrorInput {
    status: number;
    locale: unknown;
    messageKey?: unknown;
    code?: unknown;
    vars?: unknown;
}
/**
 * The single fail-closed renderer. A known key renders with bounded vars; an
 * unknown key, a literal legacy message, or a missing key all fall back to the
 * status-family copy and the status-family code.
 */
export function resolveLocalizedError(input: ResolveLocalizedErrorInput): LocalizedErrorPayload {
    const locale = toSupportedLocale(input.locale);
    if (!hasTranslationKey(input.messageKey)) {
        const family = statusFamily(input.status);
        return {
            code: family.code,
            messageKey: family.messageKey,
            message: renderTranslation(locale, family.messageKey),
        };
    }
    const messageKey = input.messageKey;
    const code = typeof input.code === 'string' && VALID_CODE.test(input.code)
        ? input.code
        : deriveErrorCode(messageKey);
    return {
        code,
        messageKey,
        message: renderTranslation(locale, messageKey, sanitizeTranslationVars(input.vars)),
    };
}
/** One localized Zod issue. `code` and `path` stay machine-stable. */
export interface LocalizedZodIssue {
    code: string;
    path: (string | number)[];
    messageKey: string;
    message: string;
}
/**
 * Zod details keep their established topology (`formErrors` / `fieldErrors`)
 * and gain the additive `issues` list.
 */
export interface LocalizedZodDetails {
    formErrors: string[];
    fieldErrors: Record<string, string[]>;
    issues: LocalizedZodIssue[];
}
type SizedType = 'array' | 'string' | 'number' | 'set' | 'date' | 'bigint';
const TOO_SMALL_KEYS: Record<SizedType, TranslationKey> = {
    string: 'validation.issue.tooSmallString',
    number: 'validation.issue.tooSmallNumber',
    bigint: 'validation.issue.tooSmallNumber',
    array: 'validation.issue.tooSmallArray',
    set: 'validation.issue.tooSmallArray',
    date: 'validation.issue.tooSmallDate',
};
const TOO_BIG_KEYS: Record<SizedType, TranslationKey> = {
    string: 'validation.issue.tooBigString',
    number: 'validation.issue.tooBigNumber',
    bigint: 'validation.issue.tooBigNumber',
    array: 'validation.issue.tooBigArray',
    set: 'validation.issue.tooBigArray',
    date: 'validation.issue.tooBigDate',
};
const STRING_VALIDATION_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
    email: 'validation.issue.invalidEmail',
    url: 'validation.issue.invalidUrl',
    uuid: 'validation.issue.invalidUuid',
    datetime: 'validation.issue.invalidDatetime',
});
const ISSUE_CODE_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
    invalid_literal: 'validation.issue.invalidLiteral',
    unrecognized_keys: 'validation.issue.unrecognizedKeys',
    invalid_union: 'validation.issue.invalidUnion',
    invalid_union_discriminator: 'validation.issue.invalidUnionDiscriminator',
    invalid_enum_value: 'validation.issue.invalidEnumValue',
    invalid_arguments: 'validation.issue.invalidArguments',
    invalid_return_type: 'validation.issue.invalidReturnType',
    invalid_date: 'validation.issue.invalidDate',
    invalid_intersection_types: 'validation.issue.invalidIntersectionTypes',
    not_finite: 'validation.issue.notFinite',
    custom: 'validation.issue.custom',
});
/** Bounded numeric bound → interpolation var; anything else is dropped. */
function boundVar(name: string, value: unknown): TranslationVars | undefined {
    if (typeof value === 'number' && Number.isFinite(value))
        return { [name]: value };
    if (typeof value === 'bigint') {
        const asNumber = Number(value);
        if (Number.isSafeInteger(asNumber))
            return { [name]: asNumber };
    }
    return undefined;
}
interface IssueTranslation {
    messageKey: TranslationKey;
    vars?: TranslationVars;
}
function withVars(messageKey: TranslationKey, vars: TranslationVars | undefined): IssueTranslation {
    return vars ? { messageKey, vars } : { messageKey };
}
function issueTranslation(issue: ZodIssue): IssueTranslation {
    // A schema author may key a refinement directly
    // (`{ message: 'sites.errors.urlInvalid' }`). A known key always wins;
    // unknown literal schema text never reaches the wire.
    if (hasTranslationKey(issue.message))
        return { messageKey: issue.message };
    if (issue.code === 'invalid_type') {
        return {
            messageKey: issue.received === 'undefined'
                ? 'validation.issue.required'
                : 'validation.issue.invalidType',
        };
    }
    if (issue.code === 'invalid_string') {
        const validation = typeof issue.validation === 'string' ? issue.validation : '';
        return {
            messageKey: STRING_VALIDATION_KEYS[validation] ?? 'validation.issue.invalidString',
        };
    }
    if (issue.code === 'too_small') {
        return withVars(TOO_SMALL_KEYS[issue.type], boundVar('minimum', issue.minimum));
    }
    if (issue.code === 'too_big') {
        return withVars(TOO_BIG_KEYS[issue.type], boundVar('maximum', issue.maximum));
    }
    if (issue.code === 'not_multiple_of') {
        return withVars('validation.issue.notMultipleOf', boundVar('multipleOf', issue.multipleOf));
    }
    return { messageKey: ISSUE_CODE_KEYS[issue.code] ?? 'validation.issue.unknown' };
}
/**
 * Localize a `ZodError` into the compatible details payload. Field paths and
 * Zod issue codes stay machine values; only the human strings are translated,
 * and literal schema text is never copied onto the wire.
 */
export function localizeZodError(locale: unknown, error: ZodError): LocalizedZodDetails {
    const resolved = toSupportedLocale(locale);
    const formErrors: string[] = [];
    const fieldErrors: Record<string, string[]> = {};
    const issues: LocalizedZodIssue[] = [];
    for (const issue of error.issues) {
        const { messageKey, vars } = issueTranslation(issue);
        const message = renderTranslation(resolved, messageKey, vars);
        const path = issue.path.filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number');
        issues.push({ code: issue.code, path, messageKey, message });
        const head = path[0];
        if (head === undefined) {
            formErrors.push(message);
            continue;
        }
        const field = String(head);
        (fieldErrors[field] ??= []).push(message);
    }
    return { formErrors, fieldErrors, issues };
}
