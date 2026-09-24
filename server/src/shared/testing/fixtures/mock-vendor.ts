/**
 * Vendor HTTP mocking for tests (prompt 05).
 *
 * WHY msw (not nock): the vendor client (`shared/providers/http.ts`) uses
 * Node 20's built-in `fetch` (undici). msw's node interceptor patches undici
 * at the dispatcher level, so native fetch is intercepted first-class —
 * nock's fetch interception only arrived in v14 and its matching API is
 * ClientRequest-centric. msw's handlers are also reusable verbatim in the
 * Playwright browser suites (prompt 19).
 *
 * Usage per test file:
 *   beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
 *   afterEach(() => vendorMockServer.resetHandlers());
 *   afterAll(() => vendorMockServer.close());
 *   mockVendor('dataforseo', 'serp-task-get', 'quota');
 */
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixture } from './load.js';
export const vendorMockServer = setupServer();
/** Intercept ALL outbound HTTP and serve the named recorded fixture. */
export function mockVendor(provider: string, operation: string, kase: string): void {
    const fixture = loadFixture(provider, operation, kase);
    if (fixture.timeout) {
        // Never answers — the client's AbortController deadline fires first.
        vendorMockServer.use(http.all('*', () => delay('infinite') as unknown as Promise<Response>));
        return;
    }
    vendorMockServer.use(http.all('*', () => HttpResponse.json(fixture.body as JsonBodyType, { status: fixture.status })));
}
