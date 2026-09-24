import type { Logger } from 'pino';
import { firecrawlCredentialRef } from '../firecrawl-credential-ref.js';
import { ProviderError, VendorAuthError } from '../errors.js';
import { createVendorHttpClient, type VendorHttpClient, type VendorHttpClientConfig, } from '../http.js';
export const FIRECRAWL_MAX_FALLBACK_API_KEYS = 5;
export { FIRECRAWL_CREDENTIAL_REF_PATTERN, firecrawlCredentialRef, } from '../firecrawl-credential-ref.js';
const FAILOVER_HTTP_STATUSES = new Set([401, 402, 429]);
const NO_SAME_KEY_RETRY_HTTP_STATUSES = new Set([402, 429]);
export interface FirecrawlCredentialPoolConfig {
    apiKey: string;
    fallbackApiKeys?: readonly string[];
    baseUrl: string;
    timeoutMs: number;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    maxRetries?: number;
}
export interface FirecrawlCredentialHandle {
    readonly credentialRef: string;
    readonly failoverClient: VendorHttpClient;
    readonly pinnedClient: VendorHttpClient;
}
export interface FirecrawlFailoverResult<T> {
    value: T;
    credential: FirecrawlCredentialHandle;
}
export interface FirecrawlCredentialPool {
    executeWithFailover<T>(operation: string, execute: (credential: FirecrawlCredentialHandle) => Promise<T>): Promise<FirecrawlFailoverResult<T>>;
    resolvePinned(credentialRef: string | undefined, operation: string): FirecrawlCredentialHandle;
}
function assertOperation(operation: string): void {
    if (operation.trim() === '')
        throw new Error('Firecrawl operation must not be empty.');
}
function normalizeKeys(config: FirecrawlCredentialPoolConfig): string[] {
    const primary = config.apiKey.trim();
    if (primary === '') {
        throw new Error('FIRECRAWL_API_KEY must not be empty.');
    }
    const fallbacks = (config.fallbackApiKeys ?? []).map((key) => key.trim());
    if (fallbacks.length > FIRECRAWL_MAX_FALLBACK_API_KEYS) {
        throw new Error(`FIRECRAWL_FALLBACK_API_KEYS supports at most ${FIRECRAWL_MAX_FALLBACK_API_KEYS} keys.`);
    }
    if (fallbacks.some((key) => key === '')) {
        throw new Error('FIRECRAWL_FALLBACK_API_KEYS must not contain empty keys.');
    }
    const keys = [primary, ...fallbacks];
    if (new Set(keys).size !== keys.length) {
        throw new Error('Firecrawl API keys must be unique.');
    }
    return keys;
}
function buildClientConfig(config: FirecrawlCredentialPoolConfig, apiKey: string): VendorHttpClientConfig {
    return {
        provider: 'firecrawl',
        baseUrl: config.baseUrl,
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: config.timeoutMs,
        quotaStatuses: [402, 429],
        ...(config.logger ? { logger: config.logger } : {}),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    };
}
function shouldRetryOnSameKey(error: ProviderError): boolean {
    return error.retryable && !NO_SAME_KEY_RETRY_HTTP_STATUSES.has(error.httpStatus ?? -1);
}
function isFailoverError(error: unknown): error is ProviderError {
    return (error instanceof ProviderError &&
        FAILOVER_HTTP_STATUSES.has(error.httpStatus ?? -1));
}
/**
 * Builds an ordered Firecrawl credential pool without exposing raw API keys.
 * Resource creation may fail over; accepted resources must retain and later
 * resolve the returned credential handle/reference for every follow-up call.
 */
export function createFirecrawlCredentialPool(config: FirecrawlCredentialPoolConfig): FirecrawlCredentialPool {
    const credentials = normalizeKeys(config).map((apiKey): FirecrawlCredentialHandle => {
        const common = buildClientConfig(config, apiKey);
        return Object.freeze({
            credentialRef: firecrawlCredentialRef(apiKey),
            failoverClient: createVendorHttpClient({
                ...common,
                shouldRetryError: shouldRetryOnSameKey,
            }),
            pinnedClient: createVendorHttpClient(common),
        });
    });
    // normalizeKeys rejects an empty primary before mapping, so the pool is
    // structurally non-empty here.
    const primary = credentials[0]!;
    const byRef = new Map(credentials.map((credential) => [credential.credentialRef, credential]));
    return {
        async executeWithFailover<T>(operation: string, execute: (credential: FirecrawlCredentialHandle) => Promise<T>): Promise<FirecrawlFailoverResult<T>> {
            assertOperation(operation);
            let lastError: unknown;
            for (const credential of credentials) {
                try {
                    const value = await execute(credential);
                    return { value, credential };
                }
                catch (error) {
                    if (!isFailoverError(error))
                        throw error;
                    lastError = error;
                }
            }
            throw lastError;
        },
        resolvePinned(reference, operation) {
            assertOperation(operation);
            if (reference === undefined)
                return primary;
            const credential = byRef.get(reference);
            if (credential !== undefined)
                return credential;
            throw new VendorAuthError('Firecrawl credential for this resource is not configured.', {
                provider: 'firecrawl',
                operation,
            });
        },
    };
}
