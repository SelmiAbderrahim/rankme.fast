import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from './sites.model.js';
import {
  SITE_LIFECYCLE_MONGO_PUBLIC_MODULES,
  SITE_SCOPED_MONGO_MODEL_NAMES,
  collectSiteMongoResources,
  purgeSiteMongoData,
  registeredSiteScopedModelNames,
} from './site-mongo-cascade.js';
import { BrandRadarScan } from '../brand-radar/brand-radar.model.js';
import { AppProfile } from '../app-seo/index.js';
import {
  BrandRadarMention,
  BrandRadarMentionSummary,
} from '../brand-radar/brand-radar.rows.model.js';
import { ChatConversation, ChatMessage } from '../chat/index.js';
import {
  ContentMonitor,
  MonitorEvidence,
  MonitorWebhookReceipt,
  deleteMonitorsForSite,
  setContentMonitorProvider,
} from '../content-monitoring/index.js';
import { createFakeContentMonitorProvider } from '../../shared/providers/content-monitor-fake.js';
import { encryptSecret } from '../../shared/crypto/index.js';
import { env } from '../../config/env.js';

function mongooseModelModuleDirectories(): string[] {
  const modulesDirectory = fileURLToPath(new URL('../', import.meta.url));
  const directories = new Set<string>();
  for (const directory of readdirSync(modulesDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const featureDirectory = new URL(`../${directory.name}/`, import.meta.url);
    for (const file of readdirSync(featureDirectory, { withFileTypes: true })) {
      if (!file.isFile() || !/\.models?\.ts$/.test(file.name)) continue;
      const contents = readFileSync(new URL(file.name, featureDirectory), 'utf8');
      if (/\bmongoose\.model(?:<|\s*\()/.test(contents)) directories.add(directory.name);
    }
  }
  return [...directories].sort();
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

describe('site Mongo lifecycle inventory', () => {
  it('registers every source module that owns a Mongoose model', () => {
    expect([
      ...SITE_LIFECYCLE_MONGO_PUBLIC_MODULES,
      // The lifecycle module already imports its own Site model directly.
      'sites',
    ].sort()).toEqual(mongooseModelModuleDirectories());
  });

  it('ratchets every shipped direct site-scoped model', async () => {
    expect(await registeredSiteScopedModelNames()).toEqual([
      ...SITE_SCOPED_MONGO_MODEL_NAMES,
    ]);
  });

  it('walks array refs, raw string site ids, and deletes descendants first', async () => {
    await clearCollections();
    const accountId = new mongoose.Types.ObjectId();
    const site = await Site.create({
      accountId,
      url: 'https://cascade.example.com',
      domain: 'cascade.example.com',
    });
    const other = await Site.create({
      accountId,
      url: 'https://other.example.com',
      domain: 'other.example.com',
    });
    const appProfile = await AppProfile.create({
      accountId,
      siteId: site._id,
      playPackageId: 'fast.rankme.sitecascade',
    });
    const otherAppProfile = await AppProfile.create({
      accountId,
      siteId: other._id,
      playPackageId: 'fast.rankme.sitecontrol',
    });

    const parentSchema = new mongoose.Schema({
      siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    });
    const childSchema = new mongoose.Schema({
      parents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LifecycleParent' }],
    });
    const rawSchema = new mongoose.Schema({ siteId: { type: String, required: true } });
    const Parent = mongoose.model('LifecycleParent', parentSchema);
    const Child = mongoose.model('LifecycleArrayChild', childSchema);
    const Raw = mongoose.model('LifecycleRawSite', rawSchema);
    try {
      const parent = await Parent.create({ siteId: site._id });
      const otherParent = await Parent.create({ siteId: other._id });
      const child = await Child.create({ parents: [parent._id] });
      const otherChild = await Child.create({ parents: [otherParent._id] });
      const raw = await Raw.create({ siteId: String(site._id) });

      const inventory = await collectSiteMongoResources(String(site._id));
      expect(inventory.idsByModel.get('LifecycleParent')).toEqual(
        new Set([String(parent._id)]),
      );
      expect(inventory.idsByModel.get('LifecycleArrayChild')).toEqual(
        new Set([String(child._id)]),
      );
      expect(inventory.idsByModel.get('LifecycleRawSite')).toEqual(
        new Set([String(raw._id)]),
      );
      expect(inventory.idsByModel.get('AppProfile')).toEqual(
        new Set([String(appProfile._id)]),
      );

      const deleted = await purgeSiteMongoData(String(site._id));
      expect(deleted.documents).toBe(4);
      expect(await Parent.exists({ _id: parent._id })).toBeNull();
      expect(await Child.exists({ _id: child._id })).toBeNull();
      expect(await Raw.exists({ _id: raw._id })).toBeNull();
      expect(await AppProfile.exists({ _id: appProfile._id })).toBeNull();
      expect(await Parent.exists({ _id: otherParent._id })).not.toBeNull();
      expect(await Child.exists({ _id: otherChild._id })).not.toBeNull();
      expect(await AppProfile.exists({ _id: otherAppProfile._id })).not.toBeNull();
      expect(await Site.exists({ _id: site._id })).not.toBeNull();
    } finally {
      await Promise.all([
        Parent.collection.drop().catch(() => undefined),
        Child.collection.drop().catch(() => undefined),
        Raw.collection.drop().catch(() => undefined),
      ]);
      mongoose.deleteModel('LifecycleParent');
      mongoose.deleteModel('LifecycleArrayChild');
      mongoose.deleteModel('LifecycleRawSite');
    }
  });

  it('fails closed when a continuing writer prevents cascade convergence', async () => {
    await clearCollections();
    const siteId = new mongoose.Types.ObjectId().toString();
    const schema = new mongoose.Schema({ siteId: { type: String, required: true } });
    const Persistent = mongoose.model('LifecyclePersistentSite', schema);
    try {
      await Persistent.create({ siteId });
      const deletion = vi.spyOn(Persistent, 'deleteMany').mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });
      await expect(purgeSiteMongoData(siteId)).rejects.toThrow(
        'site Mongo cascade did not converge after five passes',
      );
      expect(deletion).toHaveBeenCalledTimes(5);
    } finally {
      await Persistent.collection.drop().catch(() => undefined);
      mongoose.deleteModel('LifecyclePersistentSite');
    }
  });

  /**
   * Brand Radar scans were account-scoped until rankme-site-scoping 01, so
   * this cascade branch deleted nothing in practice. Now that `siteId` is
   * required, deleting a site really does take the whole scan graph with it.
   */
  it('purges a site-linked brand scan with its mention rows and summary', async () => {
    await clearCollections();
    const accountId = new mongoose.Types.ObjectId();
    const site = await Site.create({
      accountId,
      url: 'https://brand-cascade.example.com',
      domain: 'brand-cascade.example.com',
    });
    const other = await Site.create({
      accountId,
      url: 'https://brand-keep.example.com',
      domain: 'brand-keep.example.com',
    });

    async function seedScanGraph(siteId: mongoose.Types.ObjectId) {
      const scan = await BrandRadarScan.create({
        accountId,
        siteId,
        brandQuery: 'Acme Corp',
        status: 'completed',
        queryHash: 'a'.repeat(64),
      });
      await BrandRadarMention.create({
        accountId,
        scanId: scan._id,
        url: 'https://example.com/a',
        domain: 'example.com',
        polarity: 'neutral',
      });
      await BrandRadarMentionSummary.create({
        accountId,
        scanId: scan._id,
        totalMentions: 1,
      });
      return scan;
    }

    const doomed = await seedScanGraph(site._id);
    const kept = await seedScanGraph(other._id);

    const inventory = await collectSiteMongoResources(String(site._id));
    expect(inventory.idsByModel.get('BrandRadarScan')).toEqual(
      new Set([String(doomed._id)]),
    );

    await purgeSiteMongoData(String(site._id));

    expect(await BrandRadarScan.exists({ _id: doomed._id })).toBeNull();
    expect(await BrandRadarMention.exists({ scanId: doomed._id })).toBeNull();
    expect(await BrandRadarMentionSummary.exists({ scanId: doomed._id })).toBeNull();
    // The sibling site's graph is untouched.
    expect(await BrandRadarScan.exists({ _id: kept._id })).not.toBeNull();
    expect(await BrandRadarMention.exists({ scanId: kept._id })).not.toBeNull();
    expect(await BrandRadarMentionSummary.exists({ scanId: kept._id })).not.toBeNull();
  });

  it('purges a site-linked chat conversation and all of its messages', async () => {
    await clearCollections();
    const accountId = new mongoose.Types.ObjectId();
    const site = await Site.create({
      accountId,
      url: 'https://chat-cascade.example.com',
      domain: 'chat-cascade.example.com',
    });
    const other = await Site.create({
      accountId,
      url: 'https://chat-other.example.com',
      domain: 'chat-other.example.com',
    });
    const conversation = await ChatConversation.create({
      accountId: String(accountId),
      siteId: site._id,
      locale: 'en',
      lastMessageAt: new Date(),
      messageCount: 1,
    });
    const otherConversation = await ChatConversation.create({
      accountId: String(accountId),
      siteId: other._id,
      locale: 'en',
      lastMessageAt: new Date(),
      messageCount: 1,
    });
    const message = await ChatMessage.create({
      conversationId: conversation._id,
      accountId: String(accountId),
      role: 'user',
      parts: [{ type: 'text', text: 'delete me' }],
    });
    const otherMessage = await ChatMessage.create({
      conversationId: otherConversation._id,
      accountId: String(accountId),
      role: 'user',
      parts: [{ type: 'text', text: 'keep me' }],
    });

    await purgeSiteMongoData(String(site._id));

    expect(await ChatConversation.exists({ _id: conversation._id })).toBeNull();
    expect(await ChatMessage.exists({ _id: message._id })).toBeNull();
    expect(await ChatConversation.exists({ _id: otherConversation._id })).not.toBeNull();
    expect(await ChatMessage.exists({ _id: otherMessage._id })).not.toBeNull();
  });

  it('keeps monitor parents until the graph purge can delete indirect evidence', async () => {
    await clearCollections();
    const accountId = new mongoose.Types.ObjectId();
    const site = await Site.create({
      accountId,
      url: 'https://monitor-cascade.example.com',
      domain: 'monitor-cascade.example.com',
    });
    const monitor = await ContentMonitor.create({
      accountId,
      ownerUserId: accountId,
      siteId: site._id,
      targetUrl: 'https://monitor-cascade.example.com/page',
      targetKind: 'owned',
      cadence: 'weekly',
      locale: 'en',
      status: 'active',
      providerMonitorIdEncrypted: encryptSecret('remote-monitor-id'),
      providerMonitorRef: 'remote-monitor-ref',
      createdBy: accountId,
    });
    const evidence = await MonitorEvidence.create({
      monitorId: monitor._id,
      accountId,
      checkId: 'check-1',
      eventKey: 'event-1',
      sourceUrl: 'https://monitor-cascade.example.com/page',
      reason: 'content changed',
      observedAt: new Date(),
      expiryAt: new Date(Date.now() + 86_400_000),
    });
    const receipt = await MonitorWebhookReceipt.create({
      provider: 'firecrawl',
      eventId: 'site-cascade-receipt',
      monitorId: monitor._id,
      accountId,
      siteId: site._id,
      providerMonitorRef: monitor.providerMonitorRef,
      checkId: 'check-receipt',
      eventType: 'changed',
      payloadHash: 'payload-hash',
      events: [
        {
          eventKey: 'event-receipt',
          checkId: 'check-receipt',
          targetUrl: 'https://monitor-cascade.example.com/page',
          status: 'changed',
          changed: true,
          contentHash: 'new-hash',
          diffText: 'private receipt diff',
          occurredAt: new Date(),
        },
      ],
      receivedAt: new Date(),
      expiryAt: new Date(Date.now() + 86_400_000),
    });
    const provider = createFakeContentMonitorProvider();
    const deleteSpy = vi.spyOn(provider, 'deleteMonitor');
    setContentMonitorProvider(provider);
    const previousEnabled = env.CONTENT_MONITORING_ENABLED;
    env.CONTENT_MONITORING_ENABLED = false;
    try {
      await expect(deleteMonitorsForSite(String(site._id))).resolves.toBe(1);
      expect(deleteSpy).toHaveBeenCalledOnce();
      // The kill switch blocks product work, not remote vendor teardown, and
      // the local parent remains until the generic descendant walk.
      expect(await ContentMonitor.exists({ _id: monitor._id })).not.toBeNull();
      expect(await MonitorEvidence.exists({ _id: evidence._id })).not.toBeNull();
      const receiptTombstone = await MonitorWebhookReceipt.findById(receipt._id).orFail();
      expect(receiptTombstone.status).toBe('skipped');
      expect(receiptTombstone.events[0]?.diffText).toBeNull();

      await purgeSiteMongoData(String(site._id));
      expect(await ContentMonitor.exists({ _id: monitor._id })).toBeNull();
      expect(await MonitorEvidence.exists({ _id: evidence._id })).toBeNull();
      expect(await MonitorWebhookReceipt.exists({ _id: receipt._id })).toBeNull();
    } finally {
      env.CONTENT_MONITORING_ENABLED = previousEnabled;
      setContentMonitorProvider(null);
    }
  });
});
