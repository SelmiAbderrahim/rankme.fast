/**
 * Alert-rule router integration tests (community-requests spec 06).
 *
 * Covers SSRF rejection at SAVE time, masked reads, show-once secret semantics,
 * cross-account 404, the kill switch (mutations 503 / stored reads survive),
 * and the honesty invariant on every delivery DTO.
 *
 * No live DNS: the SSRF authority's resolver is injected through the module's
 * url-safety seam, so every accept/reject path is deterministic.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { alertDeliveries, alertRules } from '../../db/schema/index.js';
import { translate } from '../../shared/i18n/index.js';
import type { ResolvedAddress } from '../../shared/security/url-safety.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/sites.model.js';
import { listRulesController, resolveAlertsDb, resolveAlertsDeps } from './alerts.controller.js';
import { setAlertsDb, setAlertsUrlSafety } from './alerts.holder.js';
import { openAlertSecret } from './alerts.secrets.js';
import { resolveOwnedAlertRuleSiteId } from './alerts.controller.js';
import {
  alertsServiceTestables,
  listRulesForAccount,
} from './alerts.service.js';

const app = createApp();
let emailSeq = 0;

const PUBLIC_ADDRESS: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const PRIVATE_ADDRESS: ResolvedAddress = { address: '10.0.0.7', family: 4 };

/** Deterministic resolver: `internal.test` is private, everything else public. */
const resolver = async (hostname: string): Promise<readonly ResolvedAddress[]> =>
  hostname === 'internal.test' ? [PRIVATE_ADDRESS] : [PUBLIC_ADDRESS];

const SLACK_URL = 'https://hooks.slack.test/services/T01/B02/zzz-secret-token';
const WEBHOOK_URL = 'https://webhooks.example.test/rankmefast';

async function seedUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, {
    email: `alerts-${emailSeq}@example.test`,
  });
}

async function seedSite(user: TestUser, domain = 'example.test'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    url: `https://${domain}`,
    domain,
    displayName: domain,
  });
  return String(site._id);
}

interface RuleBody {
  siteId: string;
  type?: 'rank_drop' | 'new_backlink' | 'lost_backlink';
  threshold?: number;
  emailRecipientIds?: string[];
  slackWebhookUrl?: string;
  webhookUrl?: string;
}

function createRule(user: TestUser, body: RuleBody) {
  return request(app)
    .post('/api/alerts/rules')
    .set('Cookie', user.cookie)
    .send({ type: 'rank_drop', threshold: 10, ...body });
}

let alertsEnabled: boolean;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
  setAlertsDb(getTestDb() as unknown as never);
  setAlertsUrlSafety({ resolver });
});

afterAll(async () => {
  setAlertsUrlSafety(null);
  setAlertsDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  alertsEnabled = env.ALERTS_ENABLED;
  (env as { ALERTS_ENABLED: boolean }).ALERTS_ENABLED = true;
});

afterEach(() => {
  (env as { ALERTS_ENABLED: boolean }).ALERTS_ENABLED = alertsEnabled;
  setAlertsUrlSafety({ resolver });
});

describe('controller dependency seams', () => {
  it('uses production defaults when no test database or URL seam is installed', () => {
    setAlertsDb(null);
    setAlertsUrlSafety(null);
    try {
      const fallback = resolveAlertsDb();
      expect(fallback).toBeDefined();
      expect(resolveAlertsDeps()).toEqual({ db: fallback });
    } finally {
      setAlertsDb(getTestDb() as unknown as never);
      setAlertsUrlSafety({ resolver });
    }
  });

  it('rejects a direct controller call that bypasses the auth middleware', async () => {
    const error = await new Promise<unknown>((resolve) => {
      listRulesController({ query: {} } as never, {} as never, resolve as never);
    });
    expect(error).toMatchObject({ status: 401 });
  });
});

describe('POST /api/alerts/rules', () => {
  it('creates an email-only rank-drop rule', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      siteId,
      type: 'rank_drop',
      threshold: 10,
      enabled: true,
      emailRecipientIds: [user.id],
      slackConfigured: false,
      webhookSecretSet: false,
    });
    // Email-only rules mint no secret at all.
    expect(res.body.webhookSecret).toBeUndefined();
  });

  it('resolves the legacy self recipient alias to the authenticated user id', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      emailRecipientIds: ['self'],
    });

    expect(res.status).toBe(201);
    expect(res.body.emailRecipientIds).toEqual([user.id]);
    const [stored] = await getTestDb().select().from(alertRules);
    expect(stored?.emailRecipientIds).toEqual([user.id]);
  });

  it('returns the webhook secret exactly once and masks it on every later read', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const created = await createRule(user, { siteId, webhookUrl: WEBHOOK_URL });
    expect(created.status).toBe(201);
    const secret: string = created.body.webhookSecret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/u);
    expect(created.body.webhookSecretLast4).toBe(secret.slice(-4));

    const listed = await request(app).get('/api/alerts/rules').set('Cookie', user.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.rules).toHaveLength(1);
    expect(listed.body.rules[0].webhookSecret).toBeUndefined();
    expect(listed.body.rules[0].webhookSecretSet).toBe(true);
    expect(listed.body.rules[0].webhookSecretLast4).toBe(secret.slice(-4));
    expect(JSON.stringify(listed.body)).not.toContain(secret);
  });

  it('stores the Slack URL encrypted and never echoes it back in full', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const created = await createRule(user, {
      siteId,
      slackWebhookUrl: SLACK_URL,
    });
    expect(created.status).toBe(201);
    expect(created.body.slackConfigured).toBe(true);
    expect(created.body.slackHostMasked).toBe('hooks.slack.test/services/…');
    expect(JSON.stringify(created.body)).not.toContain('zzz-secret-token');

    const [row] = await getTestDb().select().from(alertRules);
    expect(row!.slackWebhook).not.toBeNull();
    expect(JSON.stringify(row!.slackWebhook)).not.toContain('zzz-secret-token');
    // AAD-bound to this exact rule + field.
    expect(openAlertSecret(row!.slackWebhook!, row!.id, 'slack_webhook')).toBe(SLACK_URL);
  });

  it('refuses a Slack ciphertext replayed into the webhook-secret field (AAD binding)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await createRule(user, { siteId, slackWebhookUrl: SLACK_URL });
    const [row] = await getTestDb().select().from(alertRules);
    expect(() => openAlertSecret(row!.slackWebhook!, row!.id, 'webhook_secret')).toThrow();
  });

  it('rejects a private-range channel URL at save time', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      webhookUrl: 'https://internal.test/hook',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.unsafeUrl'));
    expect(await getTestDb().select().from(alertRules)).toHaveLength(0);
  });

  it('rejects a credentialed channel URL at save time', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      webhookUrl: 'https://user:pass@webhooks.example.test/hook',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.unsafeUrl'));
  });

  it('rejects a literal loopback channel URL without touching DNS', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      webhookUrl: 'https://127.0.0.1/hook',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.unsafeUrl'));
  });

  it('rejects a non-https channel URL in zod before the authority runs', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const res = await createRule(user, {
      siteId,
      webhookUrl: 'http://webhooks.example.test/hook',
    });

    expect(res.status).toBe(400);
  });

  it('404s a site owned by another account', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);

    const res = await createRule(stranger, {
      siteId,
      emailRecipientIds: [stranger.id],
    });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.siteNotFound'));
  });

  it('404s a malformed site id', async () => {
    const user = await seedUser();
    const res = await createRule(user, {
      siteId: 'not-an-objectid',
      emailRecipientIds: [user.id],
    });
    expect(res.status).toBe(404);
  });

  it('refuses a rule with no channel', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const res = await createRule(user, { siteId });
    expect(res.status).toBe(400);
  });

  it('refuses a rank-drop rule without a threshold and a link rule with one', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);

    const noThreshold = await request(app)
      .post('/api/alerts/rules')
      .set('Cookie', user.cookie)
      .send({ siteId, type: 'rank_drop', emailRecipientIds: [user.id] });
    expect(noThreshold.status).toBe(400);

    const strayThreshold = await request(app)
      .post('/api/alerts/rules')
      .set('Cookie', user.cookie)
      .send({
        siteId,
        type: 'new_backlink',
        threshold: 5,
        emailRecipientIds: [user.id],
      });
    expect(strayThreshold.status).toBe(400);
  });

  it('refuses duplicate recipients', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const res = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id, user.id],
    });
    expect(res.status).toBe(400);
  });

  it('503s every mutation when the kill switch is off but keeps stored reads', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });
    expect(created.status).toBe(201);

    (env as { ALERTS_ENABLED: boolean }).ALERTS_ENABLED = false;

    const blocked = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.message).toBe(translate('en', 'alerts.errors.unavailable'));

    const patched = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ enabled: false });
    expect(patched.status).toBe(503);

    const removed = await request(app)
      .delete(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(removed.status).toBe(503);

    // Stored reads survive the flip — the customer keeps their configuration.
    const listed = await request(app).get('/api/alerts/rules').set('Cookie', user.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.rules).toHaveLength(1);

    const log = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries`)
      .set('Cookie', user.cookie);
    expect(log.status).toBe(200);
  });
});

describe('ownership-first rule boundaries', () => {
  it.each([
    ['enabled', true],
    ['disabled', false],
  ] as const)(
    'returns 404 for foreign and unknown resources while alerts are %s',
    async (_label, enabled) => {
      const owner = await seedUser();
      const stranger = await seedUser();
      const foreignSiteId = await seedSite(owner);
      const foreignRule = await createRule(owner, {
        siteId: foreignSiteId,
        emailRecipientIds: [owner.id],
      });
      expect(foreignRule.status).toBe(201);
      const unknownSiteId = new mongoose.Types.ObjectId().toString();
      const unknownRuleId = '00000000-0000-4000-8000-0000000000ff';
      (env as { ALERTS_ENABLED: boolean }).ALERTS_ENABLED = enabled;

      await createRule(stranger, {
        siteId: foreignSiteId,
        emailRecipientIds: [stranger.id],
      }).expect(404);
      await createRule(stranger, {
        siteId: unknownSiteId,
        emailRecipientIds: [stranger.id],
      }).expect(404);

      await request(app)
        .get(`/api/alerts/rules?siteId=${foreignSiteId}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await request(app)
        .get(`/api/alerts/rules?siteId=${unknownSiteId}`)
        .set('Cookie', stranger.cookie)
        .expect(404);

      await request(app)
        .patch(`/api/alerts/rules/${foreignRule.body.id}`)
        .set('Cookie', stranger.cookie)
        .send({ enabled: false })
        .expect(404);
      await request(app)
        .patch(`/api/alerts/rules/${unknownRuleId}`)
        .set('Cookie', stranger.cookie)
        .send({ enabled: false })
        .expect(404);

      await request(app)
        .delete(`/api/alerts/rules/${foreignRule.body.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await request(app)
        .delete(`/api/alerts/rules/${unknownRuleId}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
    },
  );
});

describe('GET /api/alerts/rules', () => {
  it('filters both rows and usage to an explicit site grant', async () => {
    const user = await seedUser();
    const allowedSiteId = await seedSite(user, 'allowed-alerts.example');
    const deniedSiteId = await seedSite(user, 'denied-alerts.example');
    await createRule(user, {
      siteId: allowedSiteId,
      emailRecipientIds: [user.id],
    }).expect(201);
    await createRule(user, {
      siteId: deniedSiteId,
      emailRecipientIds: [user.id],
    }).expect(201);

    await expect(
      listRulesForAccount(
        { accountId: user.id, query: {}, allowedSiteIds: [allowedSiteId] },
        resolveAlertsDeps(),
      ),
    ).resolves.toMatchObject({
      rules: [{ siteId: allowedSiteId }],
      cap: { used: 1 },
    });
  });

  it('filters by site, type, and enabled state and reports cap usage', async () => {
    const user = await seedUser();
    const siteA = await seedSite(user, 'a.test');
    const siteB = await seedSite(user, 'b.test');

    await createRule(user, { siteId: siteA, emailRecipientIds: [user.id] });
    const link = await request(app)
      .post('/api/alerts/rules')
      .set('Cookie', user.cookie)
      .send({
        siteId: siteB,
        type: 'new_backlink',
        emailRecipientIds: [user.id],
      });
    expect(link.status).toBe(201);
    await request(app)
      .patch(`/api/alerts/rules/${link.body.id}`)
      .set('Cookie', user.cookie)
      .send({ enabled: false });

    const all = await request(app).get('/api/alerts/rules').set('Cookie', user.cookie);
    expect(all.body.rules).toHaveLength(2);
    expect(all.body.cap).toEqual({ used: 2 });

    const bySite = await request(app)
      .get(`/api/alerts/rules?siteId=${siteB}`)
      .set('Cookie', user.cookie);
    expect(bySite.body.rules).toHaveLength(1);

    const byType = await request(app)
      .get('/api/alerts/rules?type=rank_drop')
      .set('Cookie', user.cookie);
    expect(byType.body.rules).toHaveLength(1);

    const byEnabled = await request(app)
      .get('/api/alerts/rules?enabled=false')
      .set('Cookie', user.cookie);
    expect(byEnabled.body.rules).toHaveLength(1);
    expect(byEnabled.body.rules[0].type).toBe('new_backlink');
  });

  it('never returns another account rules', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    await createRule(owner, { siteId, emailRecipientIds: [owner.id] });

    const res = await request(app).get('/api/alerts/rules').set('Cookie', stranger.cookie);
    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(0);
  });
});

describe('PATCH /api/alerts/rules/:ruleId', () => {
  it('returns 404 when the owned rule vanishes during URL validation', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    setAlertsUrlSafety({
      resolver: async () => {
        await getTestDb().delete(alertRules).where(eq(alertRules.id, created.body.id));
        return [PUBLIC_ADDRESS];
      },
    });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ webhookUrl: WEBHOOK_URL });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.ruleNotFound'));
  });

  it('rotates the webhook secret and shows it once', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, { siteId, webhookUrl: WEBHOOK_URL });
    const original: string = created.body.webhookSecret;

    const rotated = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ rotateWebhookSecret: true });

    expect(rotated.status).toBe(200);
    expect(rotated.body.webhookSecret).toMatch(/^[0-9a-f]{64}$/u);
    expect(rotated.body.webhookSecret).not.toBe(original);
    expect(rotated.body.webhookSecretLast4).toBe(rotated.body.webhookSecret.slice(-4));
  });

  it('mints a fresh secret when the webhook target changes', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, { siteId, webhookUrl: WEBHOOK_URL });

    const moved = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ webhookUrl: 'https://other.example.test/hook' });

    expect(moved.status).toBe(200);
    expect(moved.body.webhookUrl).toBe('https://other.example.test/hook');
    expect(moved.body.webhookSecret).not.toBe(created.body.webhookSecret);
  });

  it('refuses rotation when no webhook is configured', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ rotateWebhookSecret: true });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.noWebhookToRotate'));
  });

  it('clears channels when they are set to null', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post('/api/alerts/rules')
      .set('Cookie', user.cookie)
      .send({
        siteId,
        type: 'rank_drop',
        threshold: 10,
        emailRecipientIds: [user.id],
        slackWebhookUrl: SLACK_URL,
        webhookUrl: WEBHOOK_URL,
      });
    expect(created.status).toBe(201);

    const cleared = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ slackWebhookUrl: null, webhookUrl: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.slackConfigured).toBe(false);
    expect(cleared.body.slackHostMasked).toBeNull();
    expect(cleared.body.webhookUrl).toBeNull();
    expect(cleared.body.webhookSecretSet).toBe(false);
  });

  it('updates scalar fields, recipients, and a public Slack target', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    const updated = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({
        threshold: 17,
        enabled: false,
        emailRecipientIds: [user.id],
        slackWebhookUrl: SLACK_URL,
      });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      threshold: 17,
      enabled: false,
      emailRecipientIds: [user.id],
      slackConfigured: true,
      slackHostMasked: 'hooks.slack.test/services/…',
    });
  });

  it('re-validates a changed Slack URL through the SSRF authority', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ slackWebhookUrl: 'https://internal.test/services/x' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.unsafeUrl'));
  });

  it('refuses a threshold on a link rule', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post('/api/alerts/rules')
      .set('Cookie', user.cookie)
      .send({ siteId, type: 'lost_backlink', emailRecipientIds: [user.id] });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ threshold: 4 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.thresholdNotAllowed'));
  });

  it('refuses an empty patch', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it('404s another account rule', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    const created = await createRule(owner, {
      siteId,
      emailRecipientIds: [owner.id],
    });

    const res = await request(app)
      .patch(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', stranger.cookie)
      .send({ enabled: false });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(translate('en', 'alerts.errors.ruleNotFound'));
  });
});

describe('DELETE /api/alerts/rules/:ruleId', () => {
  it('removes the rule while retaining terminal delivery evidence', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    await getTestDb()
      .insert(alertDeliveries)
      .values({
        accountId: user.id,
        siteId,
        ruleId: created.body.id,
        channel: 'email',
        recipientRef: user.id,
        idempotencyKey: `alert:${created.body.id}:rank:x:email:${user.id}`,
        transitionId: 'rank:x',
        transitionKind: 'rank_drop',
        status: 'sent',
        attempt: 1,
        evidence: {
          kind: 'rank_drop',
          keyword: 'seo audit',
          threshold: 10,
          before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
          after: { at: '2026-07-02T00:00:00.000Z', position: 21 },
        },
      });

    const res = await request(app)
      .delete(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(204);
    expect(await getTestDb().select().from(alertRules)).toHaveLength(0);
    expect(await getTestDb().select().from(alertDeliveries)).toHaveLength(1);
  });

  it('404s another account rule', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    const created = await createRule(owner, {
      siteId,
      emailRecipientIds: [owner.id],
    });

    const res = await request(app)
      .delete(`/api/alerts/rules/${created.body.id}`)
      .set('Cookie', stranger.cookie);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/alerts/rules/:ruleId/deliveries', () => {
  async function seedDelivery(
    user: TestUser,
    siteId: string,
    ruleId: string,
    overrides: Partial<{
      channel: 'email' | 'slack' | 'webhook';
      status: 'pending' | 'sent' | 'failed' | 'suppressed';
      suppressedReason: 'opted_out' | null;
      key: string;
    }> = {},
  ) {
    const channel = overrides.channel ?? 'email';
    const status = overrides.status ?? 'sent';
    await getTestDb()
      .insert(alertDeliveries)
      .values({
        accountId: user.id,
        siteId,
        ruleId,
        channel,
        recipientRef: channel === 'email' ? user.id : null,
        idempotencyKey: overrides.key ?? `alert:${ruleId}:rank:1:${channel}:x`,
        transitionId: 'rank:1',
        transitionKind: 'rank_drop',
        status,
        attempt: 1,
        claimToken: status === 'pending' ? randomUUID() : null,
        suppressedReason: overrides.suppressedReason ?? null,
        evidence: {
          kind: 'rank_drop',
          keyword: 'seo audit',
          threshold: 10,
          before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
          after: { at: '2026-07-02T00:00:00.000Z', position: 21 },
        },
      });
  }

  it('returns every delivery with its stored observation pair', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });
    await seedDelivery(user, siteId, created.body.id);

    const res = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(1);
    // Honesty invariant: both observations, both dated.
    expect(res.body.deliveries[0].evidence).toMatchObject({
      kind: 'rank_drop',
      before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
      after: { at: '2026-07-02T00:00:00.000Z', position: 21 },
    });
  });

  it('filters by status and channel', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });
    await seedDelivery(user, siteId, created.body.id, { key: 'a' });
    await seedDelivery(user, siteId, created.body.id, {
      channel: 'webhook',
      status: 'failed',
      key: 'b',
    });
    await seedDelivery(user, siteId, created.body.id, {
      channel: 'slack',
      status: 'suppressed',
      suppressedReason: 'opted_out',
      key: 'c',
    });

    const failed = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries?status=failed`)
      .set('Cookie', user.cookie);
    expect(failed.body.deliveries).toHaveLength(1);
    expect(failed.body.deliveries[0].channel).toBe('webhook');

    const slack = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries?channel=slack`)
      .set('Cookie', user.cookie);
    expect(slack.body.deliveries).toHaveLength(1);
    expect(slack.body.deliveries[0].suppressedReason).toBe('opted_out');

    const limited = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries?limit=2`)
      .set('Cookie', user.cookie);
    expect(limited.body.deliveries).toHaveLength(2);
  });

  it('404s another account rule log', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    const created = await createRule(owner, {
      siteId,
      emailRecipientIds: [owner.id],
    });

    const res = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries`)
      .set('Cookie', stranger.cookie);

    expect(res.status).toBe(404);
  });

  it('rejects an unknown filter value', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await createRule(user, {
      siteId,
      emailRecipientIds: [user.id],
    });

    const res = await request(app)
      .get(`/api/alerts/rules/${created.body.id}/deliveries?status=nope`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(400);
  });
});

describe('authentication', () => {
  it('401s without a session', async () => {
    const res = await request(app).get('/api/alerts/rules');
    expect(res.status).toBe(401);
  });
});

describe('resolveOwnedAlertRuleSiteId', () => {
  // Postgres rejects a malformed uuid comparison before the route's zod
  // handler can shape a response, so the resolver screens the id itself and
  // lets the lease boundary fall through to the normal 404/400 path.
  it('returns null for a malformed rule id instead of querying Postgres', async () => {
    await expect(
      resolveOwnedAlertRuleSiteId('6a6fa7c28d75c2fd32d84a63', 'not-a-uuid'),
    ).resolves.toBeNull();
  });

  it('returns null for a well-formed rule id this account does not own', async () => {
    await expect(
      resolveOwnedAlertRuleSiteId(
        '6a6fa7c28d75c2fd32d84a63',
        '00000000-0000-4000-8000-000000000123',
      ),
    ).resolves.toBeNull();
  });
});

describe('alert service defensive boundaries', () => {
  it('enforces delete races', () => {
    expect(() => alertsServiceTestables.assertRuleRemoved(true)).not.toThrow();
    expect(() => alertsServiceTestables.assertRuleRemoved(false)).toThrow(
      'alerts.errors.ruleNotFound',
    );
  });
});
