/**
 * Provider contract-test template (prompt 05).
 *
 * Every concrete provider adapter (prompts 06+) instantiates this once per
 * operation. It asserts the four paths every provider must survive:
 * success / timeout / malformed / quota — all served from recorded fixtures.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VendorMalformedError, VendorQuotaError, VendorTimeoutError, } from '../../providers/errors.js';
import { mockVendor, vendorMockServer } from './mock-vendor.js';
export interface ProviderContractOptions<T> {
    /** Describe-block title, e.g. `DataForSeoRankProvider.checkRank`. */
    title: string;
    /** Fixture directory segments: `fixtures/<fixtureProvider>/<fixtureOperation>/`. */
    fixtureProvider: string;
    fixtureOperation: string;
    /**
     * One provider call. IMPORTANT: construct the provider under test with a
     * short deadline (`timeoutMs` ≤ 100, `maxRetries` ≤ 2, `backoffBaseMs` 1)
     * so the `timeout` case — an endpoint that never answers — resolves fast
     * under real timers.
     */
    makeCall: () => Promise<T>;
    /** Shape assertions on the parsed success result. */
    assertSuccess: (result: T) => void;
    /** Override fixture routing for multi-request operations such as async crawls. */
    mockCase?: (kase: 'success' | 'timeout' | 'malformed' | 'quota') => void;
}
export function providerContractTests<T>(opts: ProviderContractOptions<T>): void {
    describe(`${opts.title} — provider contract`, () => {
        beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
        afterEach(() => vendorMockServer.resetHandlers());
        afterAll(() => vendorMockServer.close());
        it('success: parses the recorded response to the interface shape', async () => {
            (opts.mockCase ?? ((kase) => mockVendor(opts.fixtureProvider, opts.fixtureOperation, kase)))('success');
            opts.assertSuccess(await opts.makeCall());
        });
        it('timeout: rejects with VendorTimeoutError', async () => {
            (opts.mockCase ?? ((kase) => mockVendor(opts.fixtureProvider, opts.fixtureOperation, kase)))('timeout');
            await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorTimeoutError);
        });
        it('malformed: rejects with VendorMalformedError', async () => {
            (opts.mockCase ?? ((kase) => mockVendor(opts.fixtureProvider, opts.fixtureOperation, kase)))('malformed');
            await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorMalformedError);
        });
        it('quota: rejects with VendorQuotaError', async () => {
            (opts.mockCase ?? ((kase) => mockVendor(opts.fixtureProvider, opts.fixtureOperation, kase)))('quota');
            await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorQuotaError);
        });
    });
}
