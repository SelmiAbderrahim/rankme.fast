const REDACTED_PATH_VALUE = '[redacted]';
const CREDENTIAL_PATHS: readonly RegExp[] = [
    /(\/api\/client-portal\/)[^/?#]+/gi,
    /(\/api\/report-shares\/)[^/?#]+/gi,
    /(\/api\/team\/invitations\/preview\/)[^/?#]+/gi,
    /(\/api\/team\/accept\/)[^/?#]+/gi,
    /(\/api\/team\/reject\/)[^/?#]+/gi,
];
const CREDENTIAL_QUERY_KEYS = new Set([
    'token',
    'access_token',
    'refresh_token',
    'code',
    'state',
    'secret',
]);
function decodedQueryKey(rawKey: string): string | null {
    try {
        return decodeURIComponent(rawKey.replace(/\+/g, ' '))
            .toLowerCase()
            .replace(/\[\]$/, '');
    }
    catch {
        return null;
    }
}
/** Preserve the request target byte-for-byte except for credential values. */
function redactCredentialQuery(value: string): string {
    const queryStart = value.indexOf('?');
    if (queryStart === -1)
        return value;
    const fragmentStart = value.indexOf('#', queryStart + 1);
    const queryEnd = fragmentStart === -1 ? value.length : fragmentStart;
    const prefix = value.slice(0, queryStart + 1);
    const suffix = value.slice(queryEnd);
    const query = value.slice(queryStart + 1, queryEnd);
    const redacted = query
        .split('&')
        .map((field) => {
        const separator = field.indexOf('=');
        if (separator === -1)
            return field;
        const rawKey = field.slice(0, separator);
        const key = decodedQueryKey(rawKey);
        return key !== null && CREDENTIAL_QUERY_KEYS.has(key)
            ? `${rawKey}=${REDACTED_PATH_VALUE}`
            : field;
    })
        .join('&');
    return `${prefix}${redacted}${suffix}`;
}
/**
 * Redact credentials embedded in request targets before pino-http serializes
 * them. Field-path redaction cannot protect a token that is part of `req.url`.
 */
export function redactAccessLogUrl(value: unknown): unknown {
    if (typeof value !== 'string')
        return value;
    let redacted = value;
    for (const pattern of CREDENTIAL_PATHS) {
        redacted = redacted.replace(pattern, `$1${REDACTED_PATH_VALUE}`);
    }
    return redactCredentialQuery(redacted);
}
/** pino-http request serializer, wrapped around its standard serializer. */
export function accessLogRequestSerializer(request: Record<string, unknown>): Record<string, unknown> {
    return {
        ...request,
        ...(Object.hasOwn(request, 'url')
            ? { url: redactAccessLogUrl(request.url) }
            : {}),
        ...(Object.hasOwn(request, 'originalUrl')
            ? { originalUrl: redactAccessLogUrl(request.originalUrl) }
            : {}),
    };
}
