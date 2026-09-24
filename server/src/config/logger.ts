import pino from 'pino';
import { env } from './env.js';
const isDev = env.NODE_ENV === 'development';
export const BATCH_SECRET_NAMES = [
    'FIRECRAWL_API_KEY',
    'FIRECRAWL_FALLBACK_API_KEYS',
    'FIRECRAWL_WEBHOOK_SECRET',
    'FIRECRAWL_WEBHOOK_SECRETS',
    'FIRECRAWL_WEBHOOK_SECRET_BINDINGS',
    'GLM_API_KEY',
    'DEEPSEEK_API_KEY',
    'MOONSHOT_API_KEY',
    'KIMI_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'ANTHROPIC_API_KEY',
] as const;
export const BATCH_CONTENT_FIELDS = [
    'prompt',
    'systemInstruction',
    'completion',
    'pageContent',
    'excerpt',
    'competitorSnippet',
    'signature',
    // Content Intelligence — never log the customer's owned URL,
    // target keyword, brief/draft prose, or per-analysis warning body. Kept
    // here so a diagnostic `logger.info({ analysis })` line cannot leak them.
    'ownedUrl',
    'keyword',
    'brief',
    'draft',
    'markdown',
    'logoDataUrl',
    'logoPngBase64',
    'contentBase64',
] as const;
/**
 * Review Intelligence customer-content fields.
 *
 * Review bodies, titles, and author display names are third-party personal
 * data we only hold because the account asked us to sync it; a cited theme
 * excerpt is a verbatim slice of the same text. None of it may reach a log
 * sink, so a future diagnostic `logger.info({ row })` / `logger.info({ theme })`
 * cannot leak a reviewer's words or name.
 */
export const REVIEW_CONTENT_FIELDS = [
    // Actual persisted/wire field names.
    'text',
    'title',
    'authorDisplayName',
    'excerpt',
    // Explicit aliases used by jobs/telemetry so future renames stay covered.
    'reviewText',
    'reviewTitle',
    'reviewAuthorDisplayName',
    'themeExcerpt',
] as const;
/**
 * Brand Radar customer-content fields.
 *
 * The brand query is the customer's own commercially-sensitive search term —
 * it identifies what an account is watching and must never reach a log sink.
 * `mentionSnippet` is third-party page text we retained on the account's
 * behalf, and `digestSentenceText` is generated prose quoting it; a diagnostic
 * `logger.info({ row })` / `logger.info({ sentence })` must not leak either.
 */
export const BRAND_RADAR_CONTENT_FIELDS = [
    'brandQuery',
    'mentionSnippet',
    'digestSentenceText',
] as const;
// Single source of truth for pino redaction paths. The regression suite in
// `logger.test.ts` and the pino-http integration probe import this const and
// build their own pino instance from it, so test + prod lists cannot drift.
export const REDACTION_PATHS: readonly string[] = [
    // Bootstrap superadmin + password fields.
    'SUPERADMIN_PASSWORD',
    '*.SUPERADMIN_PASSWORD',
    'password',
    '*.password',
    'req.body.password',
    'body.password',
    // Request-borne credentials / session material. pino redaction is
    // path-based; hyphenated header names (`x-csrf-token`, `set-cookie`)
    // MUST use the bracket-string form — the dot form does not parse.
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["authorization"]',
    'req.headers["cookie"]',
    'req.headers["x-csrf-token"]',
    // Firecrawl monitor webhook HMAC signature header. Redacted so a
    // diagnostic `logger.info({ req })` on the webhook route never leaks it.
    'req.headers["x-firecrawl-signature"]',
    'headers["x-firecrawl-signature"]',
    'x-firecrawl-signature',
    'res.headers["set-cookie"]',
    'authorization',
    '*.authorization',
    'cookie',
    '*.cookie',
    'cookies',
    '*.cookies',
    'accessToken',
    '*.accessToken',
    'refreshToken',
    '*.refreshToken',
    'idToken',
    '*.idToken',
    'access_token',
    '*.access_token',
    'refresh_token',
    '*.refresh_token',
    'id_token',
    '*.id_token',
    'encryptedRefreshToken',
    '*.encryptedRefreshToken',
    'encrypted_refresh_token',
    '*.encrypted_refresh_token',
    'session_token',
    '*.session_token',
    'csrfToken',
    '*.csrfToken',
    'apiKey',
    '*.apiKey',
    'apiKeys',
    '*.apiKeys',
    'fallbackApiKeys',
    '*.fallbackApiKeys',
    // Stable Firecrawl credential affinity is derived from a secret. It is not
    // usable as authentication material, but it remains an internal identifier.
    'providerCredentialRef',
    '*.providerCredentialRef',
    'credentialRef',
    '*.credentialRef',
    'config.firecrawl.apiKey',
    'config.firecrawl.apiKeys',
    'config.firecrawl.fallbackApiKeys',
    'config.firecrawl.providerCredentialRef',
    '*.credential.apiKey',
    '*.credential.credentialRef',
    '*.credential.providerCredentialRef',
    '*.firecrawl.apiKey',
    '*.firecrawl.apiKeys',
    '*.firecrawl.fallbackApiKeys',
    '*.firecrawl.credentialRef',
    '*.firecrawl.providerCredentialRef',
    'credentials[*].apiKey',
    'credentials[*].fallbackApiKeys',
    'credentials[*].credentialRef',
    'credentials[*].providerCredentialRef',
    'pool.credentials[*].apiKey',
    'pool.credentials[*].credentialRef',
    'pool.credentials[*].providerCredentialRef',
    '*[*].apiKey',
    '*[*].apiKeys',
    '*[*].fallbackApiKeys',
    '*[*].credentialRef',
    '*[*].providerCredentialRef',
    // Public share credentials (client portal and report shares). Raw values are
    // show-once and must never survive a structured request or diagnostic log.
    'token',
    '*.token',
    'portalToken',
    '*.portalToken',
    'tokenHash',
    '*.tokenHash',
    'reportShareTokenHash',
    '*.reportShareTokenHash',
    'req.reportShareTokenHash',
    'req.params.token',
    'req.query.token',
    'req.query.access_token',
    'req.query.refresh_token',
    'req.query.code',
    'req.query.state',
    'req.query.secret',
    // Alert channel credentials. A Slack
    // incoming-webhook URL IS a bearer credential, the generic-webhook HMAC
    // secret signs every outbound payload, and the signature header leaks a
    // MAC over a known body — none may ever reach a sink.
    'slackWebhook',
    '*.slackWebhook',
    'slackWebhookUrl',
    '*.slackWebhookUrl',
    'alertSlackUrl',
    '*.alertSlackUrl',
    'webhookSecret',
    '*.webhookSecret',
    'webhookSecrets',
    '*.webhookSecrets',
    'webhookSecretBindings',
    '*.webhookSecretBindings',
    'webhookSecretBindings[*].secrets',
    'bindings[*].secrets',
    'alertWebhookSecret',
    '*.alertWebhookSecret',
    'signature',
    '*.signature',
    // Env-carried vendor secrets (defends against a future
    // diagnostic `logger.info({ env })` line).
    // Session-signing secret — the single highest-value key (forges any
    // session cookie). MUST be redacted before any other env field.
    'BETTER_AUTH_SECRET',
    '*.BETTER_AUTH_SECRET',
    // DB connection strings embed credentials (user:pass@host); a logged
    // Mongoose/postgres connection-error object echoes the URI verbatim.
    'MONGODB_URI',
    '*.MONGODB_URI',
    'DATABASE_URL',
    '*.DATABASE_URL',
    ...BATCH_SECRET_NAMES.flatMap((name) => [name, `*.${name}`]),
    ...BATCH_CONTENT_FIELDS.flatMap((name) => [name, `*.${name}`]),
    ...REVIEW_CONTENT_FIELDS.flatMap((name) => [name, `*.${name}`]),
    // Arrays and structured AI inputs need explicit fast-redact paths; the
    // one-level wildcard above intentionally does not assume deep traversal.
    'reviews[*].text',
    'reviews[*].title',
    'reviews[*].authorDisplayName',
    'rows[*].text',
    'rows[*].title',
    'rows[*].authorDisplayName',
    'input.reviews[*].text',
    'input.reviews[*].title',
    'input.reviews[*].authorDisplayName',
    'payload.rows[*].text',
    'payload.rows[*].title',
    'payload.rows[*].authorDisplayName',
    'citations[*].excerpt',
    'themes[*].citations[*].excerpt',
    ...BRAND_RADAR_CONTENT_FIELDS.flatMap((name) => [name, `*.${name}`]),
    'DATAFORSEO_PASSWORD',
    '*.DATAFORSEO_PASSWORD',
    'DATAFORSEO_LOGIN',
    '*.DATAFORSEO_LOGIN',
    'GOOGLE_CLIENT_SECRET',
    '*.GOOGLE_CLIENT_SECRET',
    'GOOGLE_API_KEY',
    '*.GOOGLE_API_KEY',
    'MASTER_ENCRYPTION_KEY',
    '*.MASTER_ENCRYPTION_KEY',
    'RESEND_API_KEY',
    '*.RESEND_API_KEY',
];
export const logger = pino({
    level: env.LOG_LEVEL,
    // Never let a credential, session token, or API key reach a log sink,
    // regardless of how an object carrying it is logged. Covers request
    // headers (authorization, cookies, csrf), response headers (set-cookie),
    // env-carried secrets (Anthropic, DataForSEO, master key), and the
    // bootstrap superadmin password.
    redact: {
        paths: [...REDACTION_PATHS],
        censor: '[redacted]',
    },
    ...(isDev
        ? {
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
        }
        : {}),
});
