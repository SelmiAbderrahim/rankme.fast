import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from './sites.model.js';
import {
  assertSiteNotPaused,
  filterPausedSiteIds,
  loadOwnedSite,
} from './sites.guard.js';

const accountId = new Types.ObjectId().toHexString();

async function seedSite(overrides: Record<string, unknown> = {}) {
  return Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
    displayName: 'Example',
    ...overrides,
  });
}

describe('sites.guard', () => {
  beforeAll(async () => {
    await startMemoryMongo();
  });

  afterAll(async () => {
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  describe('assertSiteNotPaused', () => {
    it('passes for an active site', () => {
      expect(() => assertSiteNotPaused({ paused: false })).not.toThrow();
    });

    it('throws localized 409 for a paused site', () => {
      let caught: unknown;
      try {
        assertSiteNotPaused({ paused: true });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(409);
      expect((caught as HttpError).message).toBe('sites.errors.paused');
    });
  });

  describe('loadOwnedSite', () => {
    it('returns the owned site', async () => {
      const site = await seedSite();
      const loaded = await loadOwnedSite(accountId, site._id.toHexString());
      expect(loaded._id.toString()).toBe(site._id.toString());
    });

    it('404s on a malformed id', async () => {
      await expect(loadOwnedSite(accountId, 'not-an-id')).rejects.toMatchObject({
        status: 404,
        message: 'sites.errors.notFound',
      });
    });

    it('404s cross-account (never 403)', async () => {
      const site = await seedSite();
      const stranger = new Types.ObjectId().toHexString();
      await expect(
        loadOwnedSite(stranger, site._id.toHexString()),
      ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
    });

    it('409s on a paused site by default', async () => {
      const site = await seedSite({ paused: true, pausedAt: new Date() });
      await expect(
        loadOwnedSite(accountId, site._id.toHexString()),
      ).rejects.toMatchObject({ status: 409, message: 'sites.errors.paused' });
    });

    it('returns a paused site when allowPaused is set', async () => {
      const site = await seedSite({ paused: true, pausedAt: new Date() });
      const loaded = await loadOwnedSite(accountId, site._id.toHexString(), {
        allowPaused: true,
      });
      expect(loaded.paused).toBe(true);
    });

    it('treats a legacy doc without the paused field as active', async () => {
      const site = await seedSite();
      // Simulate a pre-feature document: strip the field entirely.
      await Site.collection.updateOne(
        { _id: site._id },
        { $unset: { paused: '', pausedAt: '' } },
      );
      const loaded = await loadOwnedSite(accountId, site._id.toHexString());
      expect(loaded._id.toString()).toBe(site._id.toString());
    });
  });

  describe('filterPausedSiteIds', () => {
    it('returns only the paused subset, ignoring invalid ids', async () => {
      const active = await seedSite();
      const paused = await seedSite({
        domain: 'paused.example.com',
        url: 'https://paused.example.com',
        paused: true,
        pausedAt: new Date(),
      });
      const result = await filterPausedSiteIds([
        active._id.toHexString(),
        paused._id.toHexString(),
        paused._id.toHexString(), // duplicate collapses
        'garbage-id',
      ]);
      expect(result).toEqual(new Set([paused._id.toHexString()]));
    });

    it('returns an empty set for an empty or all-invalid input', async () => {
      expect(await filterPausedSiteIds([])).toEqual(new Set());
      expect(await filterPausedSiteIds(['nope'])).toEqual(new Set());
    });
  });
});
