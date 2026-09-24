import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { loadFixture } from '../../testing/fixtures/load.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  captureVendorCost,
} from '../cost-capture.js';
import {
  VendorAuthError,
  VendorMalformedError,
  VendorUnavailableError,
} from '../errors.js';
import {
  createDataForSeoPageSpeedProvider,
  DEFAULT_DATAFORSEO_LIGHTHOUSE_TIMEOUT_MS,
  extractDataForSeoMobileFriendly,
  type DataForSeoLighthousePayload,
  type DataForSeoPageSpeedProviderConfig,
} from './pagespeed.js';

const cfg: DataForSeoPageSpeedProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  lighthouseTimeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

const provider = createDataForSeoPageSpeedProvider(cfg);

providerContractTests({
  title: 'DataForSeoPageSpeedProvider.analyze',
  fixtureProvider: 'dataforseo-pagespeed',
  fixtureOperation: 'lighthouse-live',
  makeCall: () =>
    provider.analyze({ url: 'https://example.test/', strategy: 'mobile' }),
  assertSuccess: (result) => {
    expect(result).toEqual({
      labScores: {
        performance: 84,
        accessibility: 96,
        bestPractices: 92,
        seo: 100,
      },
      mobileFriendly: true,
      fieldDataLevel: 'none',
    });
    expect(result.coreWebVitals).toBeUndefined();
  },
});

describe('DataForSeoPageSpeedProvider vendor contract details', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends one bounded task with four categories and mobile emulation', async () => {
    let body: unknown;
    const success = loadFixture(
      'dataforseo-pagespeed',
      'lighthouse-live',
      'success',
    );
    vendorMockServer.use(
      http.post('*/on_page/lighthouse/live/json', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(success.body as never);
      }),
    );
    await provider.analyze({ url: 'https://example.test/path', strategy: 'mobile' });
    expect(body).toEqual([
      {
        url: 'https://example.test/path',
        for_mobile: true,
        categories: ['performance', 'accessibility', 'best_practices', 'seo'],
      },
    ]);
  });

  it('maps desktop lab scores but never invents mobile or CrUX evidence', async () => {
    mockVendor('dataforseo-pagespeed', 'lighthouse-live', 'success');
    const result = await provider.analyze({
      url: 'https://example.test/',
      strategy: 'desktop',
    });
    expect(result.mobileFriendly).toBeUndefined();
    expect(result.coreWebVitals).toBeUndefined();
    expect((result as { fieldDataLevel?: string }).fieldDataLevel).toBe('none');
  });

  it('records the vendor-reported cost in the shared capture scope', async () => {
    mockVendor('dataforseo-pagespeed', 'lighthouse-live', 'success');
    const captured = await captureVendorCost(() =>
      provider.analyze({ url: 'https://example.test/', strategy: 'mobile' }),
    );
    expect(captured.costMicros).toBe(5_000n);
  });

  it('maps the recorded authentication failure to VendorAuthError', async () => {
    mockVendor('dataforseo-pagespeed', 'lighthouse-live', 'auth');
    await expect(
      provider.analyze({ url: 'https://example.test/', strategy: 'mobile' }),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it('rejects an empty task array as malformed', async () => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({ status_code: 20000, cost: 0, tasks: [] }),
      ),
    );
    await expect(
      provider.analyze({ url: 'https://example.test/', strategy: 'mobile' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it.each([
    ['created', 20100],
    ['in_queue', 40602],
  ] as const)('rejects unexpected live status %s as unavailable', async (_name, code) => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          status_code: 20000,
          cost: 0,
          tasks: [{ id: 'TASK_ID', status_code: code, cost: 0 }],
        }),
      ),
    );
    await expect(
      provider.analyze({ url: 'https://example.test/', strategy: 'mobile' }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('uses a deadline beyond the documented 120-second vendor ceiling', async () => {
    expect(DEFAULT_DATAFORSEO_LIGHTHOUSE_TIMEOUT_MS).toBe(130_000);
    mockVendor('dataforseo-pagespeed', 'lighthouse-live', 'success');
    const defaultDeadlineProvider = createDataForSeoPageSpeedProvider({
      login: cfg.login,
      password: cfg.password,
      baseUrl: cfg.baseUrl,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      backoffBaseMs: cfg.backoffBaseMs,
      random: cfg.random,
    });
    await expect(
      defaultDeadlineProvider.analyze({
        url: 'https://example.test/',
        strategy: 'mobile',
      }),
    ).resolves.toMatchObject({ labScores: { performance: 84 } });
  });

  it('never retries a billable Live request when production config omits maxRetries', async () => {
    let requests = 0;
    vendorMockServer.use(
      http.post('*/on_page/lighthouse/live/json', () => {
        requests += 1;
        return HttpResponse.json({ status_code: 50000 }, { status: 503 });
      }),
    );
    const productionDefaults = createDataForSeoPageSpeedProvider({
      login: cfg.login,
      password: cfg.password,
      baseUrl: cfg.baseUrl,
      timeoutMs: cfg.timeoutMs,
      lighthouseTimeoutMs: cfg.lighthouseTimeoutMs,
      backoffBaseMs: cfg.backoffBaseMs,
      random: cfg.random,
    });
    await expect(
      productionDefaults.analyze({
        url: 'https://example.test/',
        strategy: 'mobile',
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
    expect(requests).toBe(1);
  });
});

describe('extractDataForSeoMobileFriendly', () => {
  function payload(audits?: Record<string, { score?: number | null }>) {
    return {
      categories: {
        performance: { score: 1 },
        accessibility: { score: 1 },
        'best-practices': { score: 1 },
        seo: { score: 1 },
      },
      ...(audits ? { audits } : {}),
    } as DataForSeoLighthousePayload[number];
  }

  it('returns false when any available mobile-fit audit is below threshold', () => {
    expect(
      extractDataForSeoMobileFriendly(
        payload({ viewport: { score: 1 }, 'tap-targets': { score: 0.8 } }),
        'mobile',
      ),
    ).toBe(false);
  });

  it('returns undefined when no relevant mobile evidence exists', () => {
    expect(extractDataForSeoMobileFriendly(payload(), 'mobile')).toBeUndefined();
    expect(
      extractDataForSeoMobileFriendly(payload({ viewport: { score: null } }), 'mobile'),
    ).toBeUndefined();
  });

  it('returns undefined for desktop even if mobile audits are present', () => {
    expect(
      extractDataForSeoMobileFriendly(payload({ viewport: { score: 1 } }), 'desktop'),
    ).toBeUndefined();
  });
});
