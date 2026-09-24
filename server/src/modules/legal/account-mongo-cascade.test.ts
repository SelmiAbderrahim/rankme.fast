import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { AuditLog } from '../audit/index.js';
import { AppProfile } from '../app-seo/index.js';
import { Site } from '../sites/index.js';
import { User } from '../users/index.js';
import {
  ACCOUNT_LIFECYCLE_MONGO_PUBLIC_MODULES,
  ACCOUNT_SCOPED_MONGO_MODEL_NAMES,
  collectAccountMongoResources,
  purgeAccountMongoData,
  registeredAccountScopedModelNames,
} from './account-mongo-cascade.js';

function mongooseModelModuleDirectories(): string[] {
  const modulesDirectory = fileURLToPath(new URL('../', import.meta.url));
  const directories = new Set<string>();
  for (const directory of readdirSync(modulesDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const featureDirectory = new URL(`../${directory.name}/`, import.meta.url);
    for (const file of readdirSync(featureDirectory, { withFileTypes: true })) {
      if (!file.isFile() || !/\.models?\.ts$/.test(file.name)) continue;
      const contents = readFileSync(new URL(file.name, featureDirectory), 'utf8');
      if (/\b(?:mongoose\.)?model(?:<|\s*\()/.test(contents)) {
        directories.add(directory.name);
      }
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

beforeEach(async () => {
  await clearCollections();
});

describe('account Mongo lifecycle inventory', () => {
  it('registers every source module that owns a Mongoose model', () => {
    expect([...ACCOUNT_LIFECYCLE_MONGO_PUBLIC_MODULES]).toEqual(
      mongooseModelModuleDirectories(),
    );
  });

  it('ratchets every shipped direct account-scoped model', async () => {
    expect(await registeredAccountScopedModelNames()).toEqual([
      ...ACCOUNT_SCOPED_MONGO_MODEL_NAMES,
    ]);
  });

  it('deletes the account graph children-first without crossing account or actor edges', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const controlId = new mongoose.Types.ObjectId();
    await Promise.all([
      User.create({ _id: accountId, email: 'delete-mongo@example.com' }),
      User.create({ _id: controlId, email: 'control-mongo@example.com' }),
    ]);
    const site = await Site.create({
      accountId,
      url: 'https://account-cascade.example.com',
      domain: 'account-cascade.example.com',
    });
    const appProfile = await AppProfile.create({
      accountId,
      siteId: site._id,
      playPackageId: 'fast.rankme.accountcascade',
    });
    const retainedAudit = await AuditLog.create({
      actorUserId: accountId,
      action: 'data.delete.completed',
      targetType: 'user',
      targetId: String(accountId),
      ip: '203.0.113.4',
      metadata: { email: 'delete-mongo@example.com' },
    });

    const parentSchema = new mongoose.Schema({
      accountId: { type: String, required: true },
    });
    const childSchema = new mongoose.Schema({
      parents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AccountLifecycleParent' }],
    });
    const actorOnlySchema = new mongoose.Schema({
      actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      label: { type: String, required: true },
    });
    const Parent = mongoose.model('AccountLifecycleParent', parentSchema);
    const Child = mongoose.model('AccountLifecycleArrayChild', childSchema);
    const ActorOnly = mongoose.model('AccountLifecycleActorOnly', actorOnlySchema);
    try {
      const parent = await Parent.create({ accountId: String(accountId) });
      const controlParent = await Parent.create({ accountId: String(controlId) });
      const child = await Child.create({ parents: [parent._id] });
      const controlChild = await Child.create({ parents: [controlParent._id] });
      const actorOnly = await ActorOnly.create({ actorUserId: accountId, label: 'shared' });

      const inventory = await collectAccountMongoResources(String(accountId));
      expect(inventory.idsByModel.get('AccountLifecycleParent')).toEqual(
        new Set([String(parent._id)]),
      );
      expect(inventory.idsByModel.get('AccountLifecycleArrayChild')).toEqual(
        new Set([String(child._id)]),
      );
      expect(inventory.idsByModel.get('AppProfile')).toEqual(
        new Set([String(appProfile._id)]),
      );
      expect(inventory.idsByModel.has('AccountLifecycleActorOnly')).toBe(false);

      const result = await purgeAccountMongoData(String(accountId));
      expect(result.documents).toBe(3);
      expect(await Parent.exists({ _id: parent._id })).toBeNull();
      expect(await Child.exists({ _id: child._id })).toBeNull();
      expect(await AppProfile.exists({ _id: appProfile._id })).toBeNull();
      expect(await Parent.exists({ _id: controlParent._id })).not.toBeNull();
      expect(await Child.exists({ _id: controlChild._id })).not.toBeNull();
      expect(await ActorOnly.exists({ _id: actorOnly._id })).not.toBeNull();
      expect(await Site.exists({ _id: site._id })).not.toBeNull();
      expect(await AuditLog.exists({ _id: retainedAudit._id })).not.toBeNull();
      expect(await User.exists({ _id: accountId })).not.toBeNull();
    } finally {
      await Promise.all([
        Parent.collection.drop().catch(() => undefined),
        Child.collection.drop().catch(() => undefined),
        ActorOnly.collection.drop().catch(() => undefined),
      ]);
      mongoose.deleteModel('AccountLifecycleParent');
      mongoose.deleteModel('AccountLifecycleArrayChild');
      mongoose.deleteModel('AccountLifecycleActorOnly');
    }
  });

  it('fails closed when a hostile model prevents fixed-point convergence', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const schema = new mongoose.Schema({ accountId: { type: String, required: true } });
    const Hostile = mongoose.model('AccountLifecycleNonConverging', schema);
    try {
      await Hostile.create({ accountId });
      vi.spyOn(Hostile, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as never);
      await expect(purgeAccountMongoData(accountId)).rejects.toThrow(
        'account Mongo cascade did not converge after five passes',
      );
    } finally {
      vi.restoreAllMocks();
      await Hostile.collection.drop().catch(() => undefined);
      mongoose.deleteModel('AccountLifecycleNonConverging');
    }
  });
});
