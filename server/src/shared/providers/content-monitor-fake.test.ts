import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from './errors.js';
import { createFakeContentMonitorProvider } from './content-monitor-fake.js';
import { contentMonitorDeliveryKey } from './content-monitor.js';

const createInput = {
  targetUrl: 'https://example.com/pricing',
  cadence: 'weekly' as const,
  callbackUrl: 'https://app.example.com/api/firecrawl/webhook',
  timeoutMs: 30_000,
  metadata: { monitorRef: 'ref_1' },
};
const ref = { providerMonitorId: 'fakemon_abc', timeoutMs: 30_000 };

describe('fake content monitor provider', () => {
  it('creates a deterministic opaque monitor id', async () => {
    const p = createFakeContentMonitorProvider();
    const a = await p.createMonitor(createInput);
    const b = await p.createMonitor(createInput);
    expect(a.providerMonitorId).toMatch(/^fakemon_[0-9a-f]{24}$/);
    expect(a.providerMonitorId).toBe(b.providerMonitorId);
    expect(a).toMatchObject({
      providerCredentialRef: 'fake-content-monitor-primary',
      status: 'active',
      cadence: 'weekly',
    });
  });

  it('supports an id-prefix override', async () => {
    const p = createFakeContentMonitorProvider({ idPrefix: 'zz' });
    const created = await p.createMonitor(createInput);
    expect(created.providerMonitorId.startsWith('zz_')).toBe(true);
  });

  it('rejects invalid create input', async () => {
    const p = createFakeContentMonitorProvider();
    await expect(p.createMonitor({ ...createInput, targetUrl: '' })).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('pauses, resumes, reads status, and deletes', async () => {
    const p = createFakeContentMonitorProvider();
    await expect(p.pauseMonitor(ref)).resolves.toEqual({
      providerMonitorId: ref.providerMonitorId,
      status: 'paused',
    });
    await expect(p.resumeMonitor(ref)).resolves.toEqual({
      providerMonitorId: ref.providerMonitorId,
      status: 'active',
    });
    await expect(p.getMonitorStatus(ref)).resolves.toEqual({
      providerMonitorId: ref.providerMonitorId,
      status: 'active',
    });
    await expect(p.deleteMonitor(ref)).resolves.toBeUndefined();
  });

  it('rejects an invalid monitor ref on lifecycle calls', async () => {
    const p = createFakeContentMonitorProvider();
    await expect(p.pauseMonitor({ providerMonitorId: '', timeoutMs: 1 })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('rejects an unknown credential reference without probing another owner', async () => {
    const p = createFakeContentMonitorProvider();
    await expect(
      p.getMonitorStatus({ ...ref, providerCredentialRef: 'unknown-fake-credential' }),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it.each([
    ['timeout', VendorTimeoutError],
    ['malformed', VendorMalformedError],
    ['quota', VendorQuotaError],
    ['unavailable', VendorUnavailableError],
  ] as const)('surfaces the injected %s failure on lifecycle calls', async (mode, Err) => {
    const p = createFakeContentMonitorProvider({ mode });
    await expect(p.createMonitor(createInput)).rejects.toBeInstanceOf(Err);
    await expect(p.pauseMonitor(ref)).rejects.toBeInstanceOf(Err);
    await expect(p.resumeMonitor(ref)).rejects.toBeInstanceOf(Err);
    await expect(p.getMonitorStatus(ref)).rejects.toBeInstanceOf(Err);
    await expect(p.deleteMonitor(ref)).rejects.toBeInstanceOf(Err);
  });

  it('normalizes a monitor.page delivery with sanitized diffs', () => {
    const p = createFakeContentMonitorProvider({ clock: () => new Date('2026-05-05T00:00:00.000Z') });
    const delivery = p.normalizeWebhookDelivery({
      type: 'monitor.page',
      monitorId: 'mon_1',
      checkId: 'chk_1',
      pages: [
        { url: 'https://example.com/a', status: 'changed', changed: true, contentHash: 'h1', diff: '<b>x</b> y' },
        { url: 'https://example.com/b', status: 'same', changed: false },
      ],
    });
    expect(delivery.eventType).toBe('monitor.page');
    expect(delivery.deliveryKey).toBe(
      contentMonitorDeliveryKey('monitor.page', 'chk_1', 'fake-content-monitor-primary'),
    );
    expect(delivery.providerMonitorId).toBe('mon_1');
    expect(delivery.providerCredentialRef).toBe('fake-content-monitor-primary');
    expect(delivery.events).toHaveLength(2);
    expect(delivery.events[0]).toMatchObject({
      targetUrl: 'https://example.com/a',
      status: 'changed',
      changed: true,
      contentHash: 'h1',
      diffText: 'x y',
      occurredAt: new Date('2026-05-05T00:00:00.000Z'),
    });
    expect(delivery.events[1]!.contentHash).toBeNull();
    expect(delivery.events[1]!.diffText).toBeNull();
  });

  it('normalizes a monitor.check.completed delivery', () => {
    const p = createFakeContentMonitorProvider();
    const delivery = p.normalizeWebhookDelivery({
      type: 'monitor.check.completed',
      monitorId: 'mon_1',
      checkId: 'chk_9',
      pages: [],
    });
    expect(delivery.deliveryKey).toMatch(/^monitor\.check\.completed:[0-9a-f]{64}$/);
    expect(delivery.providerCredentialRef).toBe('fake-content-monitor-primary');
    expect(delivery.checkId).toBe('chk_9');
    expect(delivery.events).toEqual([]);
  });

  it('carries an optional credential reference into a scoped delivery key', () => {
    const p = createFakeContentMonitorProvider();
    const delivery = p.normalizeWebhookDelivery({
      type: 'monitor.check.completed',
      monitorId: 'mon_1',
      providerCredentialRef: 'credential-b',
      checkId: 'chk_9',
      pages: [],
    });
    expect(delivery.providerCredentialRef).toBe('credential-b');
    expect(delivery.deliveryKey).toMatch(/^monitor\.check\.completed:[0-9a-f]{64}$/);
    expect(delivery.deliveryKey).not.toContain('credential-b');
  });

  it('preserves metadata-free legacy delivery keys when null is explicit', () => {
    const delivery = createFakeContentMonitorProvider().normalizeWebhookDelivery({
      type: 'monitor.check.completed',
      monitorId: 'legacy-monitor',
      providerCredentialRef: null,
      checkId: 'legacy-check',
      pages: [],
    });
    expect(delivery.providerCredentialRef).toBeUndefined();
    expect(delivery.deliveryKey).toBe('monitor.check.completed:legacy-check');
  });

  it('stamps the default fake clock when none is injected', () => {
    const p = createFakeContentMonitorProvider();
    const delivery = p.normalizeWebhookDelivery({
      type: 'monitor.page',
      monitorId: 'mon_1',
      checkId: 'chk_1',
      pages: [{ url: 'https://example.com/a', status: 'new', changed: true }],
    });
    expect(delivery.events[0]!.occurredAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('rejects a malformed webhook body', () => {
    const p = createFakeContentMonitorProvider();
    expect(() => p.normalizeWebhookDelivery({ type: 'bogus' })).toThrow(VendorMalformedError);
  });
});
