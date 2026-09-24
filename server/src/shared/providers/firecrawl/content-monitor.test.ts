import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { pino } from 'pino';
import { loadFixture } from '../../testing/fixtures/load.js';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorAuthError, VendorMalformedError, VendorUnavailableError } from '../errors.js';
import { CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY } from '../content-monitor.js';
import {
  FIRECRAWL_CREDENTIAL_REF_METADATA_KEY,
  createFirecrawlContentMonitorProvider,
  type FirecrawlContentMonitorConfig,
} from './content-monitor.js';

const cfg: FirecrawlContentMonitorConfig = {
  apiKey: 'fixture-key',
  baseUrl: 'https://api.firecrawl.dev',
  timeoutMs: 250,
  zdrEnabled: true,
  maxRetries: 0,
  clock: () => new Date('2026-07-20T00:00:00.000Z'),
};
const provider = createFirecrawlContentMonitorProvider(cfg);

const createInput = {
  targetUrl: 'https://example.com/pricing',
  cadence: 'weekly' as const,
  callbackUrl: 'https://app.example.com/api/firecrawl/webhook',
  timeoutMs: 250,
  metadata: { monitorRef: 'MONITOR_REF' },
};
const ref = { providerMonitorId: 'mon_123', timeoutMs: 250 };

function body(operation: string, kase: string): Record<string, unknown> {
  return loadFixture('firecrawl-monitor', operation, kase).body as Record<string, unknown>;
}

providerContractTests({
  title: 'FirecrawlContentMonitorProvider.createMonitor',
  fixtureProvider: 'firecrawl-monitor',
  fixtureOperation: 'create',
  makeCall: () => provider.createMonitor(createInput),
  assertSuccess: (result) => {
    expect(result.providerMonitorId).toBe('TASK_ID');
    expect(result.providerCredentialRef).toMatch(/^fc-cred-v1:[0-9a-f]{64}$/);
    expect(result.status).toBe('active');
    expect(result.cadence).toBe('weekly');
  },
});

describe('Firecrawl content monitor lifecycle', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends a weekly, judge-disabled, ZDR-safe monitor create body', async () => {
    let requestBody: Record<string, unknown> | null = null;
    vendorMockServer.use(
      http.post('*/v2/monitor', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(body('create', 'success'));
      }),
    );
    const created = await provider.createMonitor(createInput);
    expect(requestBody).toMatchObject({
      name: 'rankmefast-weekly',
      schedule: { text: 'weekly', timezone: 'UTC' },
      judgeEnabled: false,
      retentionDays: 30,
      zeroDataRetention: true,
      webhook: {
        url: 'https://app.example.com/api/firecrawl/webhook',
        events: ['monitor.page', 'monitor.check.completed'],
        metadata: {
          monitorRef: 'MONITOR_REF',
          [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: created.providerCredentialRef,
        },
      },
    });
    expect(requestBody).not.toHaveProperty('goal');
  });

  it('always injects the reserved credential metadata when caller metadata is absent', async () => {
    let requestBody: Record<string, unknown> | null = null;
    vendorMockServer.use(
      http.post('*/v2/monitor', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(body('create', 'success'));
      }),
    );
    const { metadata: _drop, ...noMeta } = createInput;
    const created = await provider.createMonitor(noMeta);
    expect((requestBody as unknown as { webhook: { metadata: Record<string, unknown> } }).webhook)
      .toMatchObject({
        metadata: {
          [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: created.providerCredentialRef,
        },
      });
  });

  it('does not allow caller metadata to override the reserved credential reference', async () => {
    let requestBody: Record<string, unknown> | null = null;
    vendorMockServer.use(
      http.post('*/v2/monitor', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(body('create', 'success'));
      }),
    );
    const created = await provider.createMonitor({
      ...createInput,
      metadata: {
        [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: 'caller-controlled',
      },
    });
    const webhook = (requestBody as unknown as {
      webhook: { metadata: Record<string, string> };
    }).webhook;
    expect(webhook.metadata[FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]).toBe(
      created.providerCredentialRef,
    );
    expect(created.providerCredentialRef).not.toBe('caller-controlled');
  });

  it.each([401, 402, 429])(
    'fails over monitor creation after HTTP %s and binds the winning credential',
    async (status) => {
      const attempts: Array<{ authorization: string | null; credentialRef: unknown }> = [];
      vendorMockServer.use(
        http.post('*/v2/monitor', async ({ request }) => {
          const requestBody = (await request.json()) as {
            webhook: { metadata: Record<string, unknown> };
          };
          const authorization = request.headers.get('authorization');
          attempts.push({
            authorization,
            credentialRef:
              requestBody.webhook.metadata[FIRECRAWL_CREDENTIAL_REF_METADATA_KEY],
          });
          if (authorization === 'Bearer fixture-key') {
            return HttpResponse.json({ success: false, error: 'try another key' }, { status });
          }
          return HttpResponse.json(body('create', 'success'));
        }),
      );
      const fallbackProvider = createFirecrawlContentMonitorProvider({
        ...cfg,
        fallbackApiKeys: ['fixture-fallback-key'],
      });
      const created = await fallbackProvider.createMonitor(createInput);
      expect(attempts.map((attempt) => attempt.authorization)).toEqual([
        'Bearer fixture-key',
        'Bearer fixture-fallback-key',
      ]);
      expect(attempts[0]!.credentialRef).not.toBe(attempts[1]!.credentialRef);
      expect(created.providerCredentialRef).toBe(attempts[1]!.credentialRef);
    },
  );

  it('does not fail over a ZDR/permission 403', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.post('*/v2/monitor', () => {
        calls += 1;
        return HttpResponse.json({ success: false, error: 'ZDR required' }, { status: 403 });
      }),
    );
    const fallbackProvider = createFirecrawlContentMonitorProvider({
      ...cfg,
      fallbackApiKeys: ['fixture-fallback-key'],
    });
    await expect(fallbackProvider.createMonitor(createInput)).rejects.toBeInstanceOf(
      VendorAuthError,
    );
    expect(calls).toBe(1);
  });

  it('rejects invalid create input before any request', async () => {
    await expect(
      provider.createMonitor({ ...createInput, targetUrl: '' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('pauses, resumes, and reads status via PATCH/GET', async () => {
    let patchBody: Record<string, unknown> | null = null;
    vendorMockServer.use(
      http.patch('*/v2/monitor/*', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { id: 'mon_123', status: patchBody!.status } });
      }),
      http.get('*/v2/monitor/*', () =>
        HttpResponse.json({ data: { id: 'mon_123', status: 'active' } }),
      ),
    );
    await expect(provider.pauseMonitor(ref)).resolves.toEqual({
      providerMonitorId: 'mon_123',
      status: 'paused',
    });
    expect(patchBody).toEqual({ status: 'paused' });
    await expect(provider.resumeMonitor(ref)).resolves.toEqual({
      providerMonitorId: 'mon_123',
      status: 'active',
    });
    await expect(provider.getMonitorStatus(ref)).resolves.toEqual({
      providerMonitorId: 'mon_123',
      status: 'active',
    });
  });

  it('maps unknown/failed vendor status to error', async () => {
    vendorMockServer.use(
      http.get('*/v2/monitor/*', () =>
        HttpResponse.json({ data: { id: 'mon_123', status: 'failed' } }),
      ),
    );
    await expect(provider.getMonitorStatus(ref)).resolves.toEqual({
      providerMonitorId: 'mon_123',
      status: 'error',
    });
  });

  it('deletes a monitor through an injected fetch implementation', async () => {
    let called = false;
    vendorMockServer.use(
      http.delete('*/v2/monitor/*', () => {
        called = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const injected = createFirecrawlContentMonitorProvider({ ...cfg, fetchImpl: fetch });
    await injected.deleteMonitor(ref);
    expect(called).toBe(true);
  });

  it('treats an already-missing monitor as successful idempotent deletion', async () => {
    vendorMockServer.use(
      http.delete('*/v2/monitor/*', () =>
        HttpResponse.json({ success: false, error: 'not found' }, { status: 404 }),
      ),
    );
    const injected = createFirecrawlContentMonitorProvider({ ...cfg, fetchImpl: fetch });
    await expect(injected.deleteMonitor(ref)).resolves.toBeUndefined();
  });

  it('preserves non-404 provider failures when deleting a monitor', async () => {
    vendorMockServer.use(
      http.delete('*/v2/monitor/*', () =>
        HttpResponse.json({ success: false, error: 'unavailable' }, { status: 500 }),
      ),
    );
    const injected = createFirecrawlContentMonitorProvider({ ...cfg, fetchImpl: fetch });
    await expect(injected.deleteMonitor(ref)).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('pins every lifecycle request to the credential that created the monitor', async () => {
    const calls: Array<{ method: string; authorization: string | null }> = [];
    vendorMockServer.use(
      http.post('*/v2/monitor', ({ request }) => {
        const authorization = request.headers.get('authorization');
        calls.push({ method: 'POST', authorization });
        if (authorization === 'Bearer fixture-key') {
          return HttpResponse.json({ success: false }, { status: 401 });
        }
        return HttpResponse.json(body('create', 'success'));
      }),
      http.patch('*/v2/monitor/*', ({ request }) => {
        calls.push({
          method: 'PATCH',
          authorization: request.headers.get('authorization'),
        });
        return HttpResponse.json({
          success: true,
          data: { id: 'TASK_ID', status: 'paused' },
        });
      }),
    );
    const fallbackProvider = createFirecrawlContentMonitorProvider({
      ...cfg,
      fallbackApiKeys: ['fixture-fallback-key'],
    });
    const created = await fallbackProvider.createMonitor(createInput);
    await fallbackProvider.pauseMonitor({
      providerMonitorId: created.providerMonitorId,
      providerCredentialRef: created.providerCredentialRef,
      timeoutMs: 250,
    });
    expect(calls).toEqual([
      { method: 'POST', authorization: 'Bearer fixture-key' },
      { method: 'POST', authorization: 'Bearer fixture-fallback-key' },
      { method: 'PATCH', authorization: 'Bearer fixture-fallback-key' },
    ]);
  });

  it('uses the primary for legacy refs and rejects an unknown bound credential without probing', async () => {
    const calls: Array<string | null> = [];
    vendorMockServer.use(
      http.patch('*/v2/monitor/*', ({ request }) => {
        calls.push(request.headers.get('authorization'));
        return HttpResponse.json({
          success: true,
          data: { id: 'mon_123', status: 'paused' },
        });
      }),
    );
    const fallbackProvider = createFirecrawlContentMonitorProvider({
      ...cfg,
      fallbackApiKeys: ['fixture-fallback-key'],
    });
    await fallbackProvider.pauseMonitor(ref);
    await expect(
      fallbackProvider.pauseMonitor({
        ...ref,
        providerCredentialRef: 'fc-cred-v1:removed',
      }),
    ).rejects.toBeInstanceOf(VendorAuthError);
    expect(calls).toEqual(['Bearer fixture-key']);
  });

  it('rejects an invalid monitor ref', async () => {
    await expect(
      provider.deleteMonitor({ providerMonitorId: '', timeoutMs: 250 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('Firecrawl content monitor webhook normalization', () => {
  it('normalizes a monitor.page delivery to provider-neutral events', () => {
    const delivery = provider.normalizeWebhookDelivery(body('webhook', 'monitor-page'));
    expect(delivery.eventType).toBe('monitor.page');
    expect(delivery.providerMonitorId).toBe('TASK_ID');
    expect(delivery.checkId).toBe('CHECK_ID');
    expect(delivery.events).toHaveLength(1);
    const event = delivery.events[0]!;
    expect(event).toMatchObject({
      providerMonitorId: 'TASK_ID',
      checkId: 'CHECK_ID',
      targetUrl: 'https://example.com/pricing',
      status: 'changed',
      changed: true,
    });
    expect(event.diffText).toBe('- Old price $19 + New price $29');
    expect(event.eventKey).toHaveLength(64);
    expect(delivery.deliveryKey.startsWith('monitor.page:')).toBe(true);
  });

  it('normalizes a monitor.check.completed delivery with no page events', () => {
    const delivery = provider.normalizeWebhookDelivery(body('webhook', 'monitor-check-completed'));
    expect(delivery.eventType).toBe('monitor.check.completed');
    expect(delivery.deliveryKey).toBe('monitor.check.completed:CHECK_ID');
    expect(delivery.events).toEqual([]);
  });

  it('normalizes the signed credential metadata into scoped correlation fields', () => {
    const credentialRef = `fc-cred-v1:${'b'.repeat(64)}`;
    const delivery = provider.normalizeWebhookDelivery({
      type: 'monitor.check.completed',
      metadata: {
        [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: credentialRef,
      },
      data: [{ monitorId: 'shared-id', checkId: 'shared-check', status: 'completed' }],
    });
    expect(delivery.providerCredentialRef).toBe(credentialRef);
    expect(delivery.deliveryKey).toMatch(/^monitor\.check\.completed:[0-9a-f]{64}$/);
    expect(delivery.deliveryKey).not.toContain(credentialRef);
  });

  it('scopes monitor.page correlation with signed credential metadata', () => {
    const credentialRef = `fc-cred-v1:${'c'.repeat(64)}`;
    const delivery = provider.normalizeWebhookDelivery({
      type: 'monitor.page',
      metadata: {
        [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: credentialRef,
      },
      data: [
        {
          monitorId: 'shared-id',
          checkId: 'shared-check',
          url: 'https://example.com/page',
          status: 'changed',
        },
      ],
    });

    expect(delivery.providerCredentialRef).toBe(credentialRef);
    expect(delivery.deliveryKey).toMatch(/^monitor\.page:[0-9a-f]{64}$/);
    expect(delivery.deliveryKey).not.toContain(credentialRef);
  });

  it.each([123, 'fc-cred-v1:short'])('rejects malformed reserved credential metadata %p', (value) => {
    expect(() =>
      provider.normalizeWebhookDelivery({
        type: 'monitor.check.completed',
        metadata: { [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: value },
        data: [{ monitorId: 'm1', checkId: 'c1', status: 'completed' }],
      }),
    ).toThrow(VendorMalformedError);
  });

  it('marks same/error page statuses as unchanged', () => {
    const delivery = provider.normalizeWebhookDelivery({
      type: 'monitor.page',
      data: [
        { monitorId: 'm1', checkId: 'c1', url: 'https://example.com/a', status: 'same' },
        { monitorId: 'm1', checkId: 'c1', url: 'https://example.com/b', status: 'removed', diff: { text: null } },
      ],
    });
    expect(delivery.events.map((e) => e.changed)).toEqual([false, true]);
    expect(delivery.events[0]!.diffText).toBeNull();
  });

  it('coerces an unknown vendor page status to error', () => {
    const delivery = provider.normalizeWebhookDelivery({
      type: 'monitor.page',
      data: [{ monitorId: 'm1', checkId: 'c1', url: 'https://example.com/a', status: 'wat' }],
    });
    expect(delivery.events[0]!.status).toBe('error');
  });

  it('rejects a non-envelope body', () => {
    expect(() => provider.normalizeWebhookDelivery({ nope: true })).toThrow(VendorMalformedError);
  });

  it('rejects an over-long batch (amplification guard)', () => {
    const data = Array.from({ length: CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY + 1 }, (_v, i) => ({
      monitorId: 'm1',
      checkId: 'c1',
      url: `https://example.com/${i}`,
      status: 'changed',
    }));
    expect(() => provider.normalizeWebhookDelivery({ type: 'monitor.page', data })).toThrow(
      VendorMalformedError,
    );
  });

  it('rejects a monitor.page delivery with a malformed entry', () => {
    expect(() =>
      provider.normalizeWebhookDelivery({
        type: 'monitor.page',
        data: [{ monitorId: 'm1', checkId: 'c1' }],
      }),
    ).toThrow(VendorMalformedError);
  });

  it('rejects a monitor.page delivery with an empty batch', () => {
    expect(() => provider.normalizeWebhookDelivery({ type: 'monitor.page', data: [] })).toThrow(
      VendorMalformedError,
    );
  });

  it('rejects a monitor.check.completed delivery with a malformed entry', () => {
    expect(() =>
      provider.normalizeWebhookDelivery({ type: 'monitor.check.completed', data: [{ monitorId: 'm1' }] }),
    ).toThrow(VendorMalformedError);
  });

  it('uses the system clock when none is injected', () => {
    const live = createFirecrawlContentMonitorProvider({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      timeoutMs: 100,
      zdrEnabled: true,
      logger: pino({ level: 'silent' }),
    });
    const before = Date.now();
    const delivery = live.normalizeWebhookDelivery({
      type: 'monitor.page',
      data: [{ monitorId: 'm1', checkId: 'c1', url: 'https://example.com/a', status: 'new' }],
    });
    const after = Date.now();
    const occurred = delivery.events[0]!.occurredAt.getTime();
    expect(occurred).toBeGreaterThanOrEqual(before);
    expect(occurred).toBeLessThanOrEqual(after);
  });
});

describe('Firecrawl content monitor configuration boundary', () => {
  it('requires the key, ZDR attestation, positive timeout, and Cloud origin', () => {
    expect(() => createFirecrawlContentMonitorProvider({ ...cfg, apiKey: '' })).toThrow(
      /FIRECRAWL_API_KEY/,
    );
    expect(() =>
      createFirecrawlContentMonitorProvider({ ...cfg, zdrEnabled: false }),
    ).toThrow(/FIRECRAWL_ZDR_ENABLED=true/);
    expect(() => createFirecrawlContentMonitorProvider({ ...cfg, timeoutMs: 0 })).toThrow(
      /FIRECRAWL_TIMEOUT_MS/,
    );
    expect(() =>
      createFirecrawlContentMonitorProvider({ ...cfg, baseUrl: 'https://self-host.example' }),
    ).toThrow(/self-hosted/);
    expect(() =>
      createFirecrawlContentMonitorProvider({ ...cfg, baseUrl: 'https://api.firecrawl.dev/v2' }),
    ).toThrow(/Cloud API origin/);
    expect(() =>
      createFirecrawlContentMonitorProvider({ ...cfg, baseUrl: 'https://user:pw@api.firecrawl.dev' }),
    ).toThrow(/Cloud API origin/);
  });
});
