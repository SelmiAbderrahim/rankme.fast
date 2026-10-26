import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { teamMembers } from '../../db/schema/team-members.js';
import { trafficSnapshots } from '../../db/schema/traffic-snapshots.js';
import { TrafficSnapshotRun } from '../../modules/competitors/traffic-snapshots.model.js';
import { buildTrafficSnapshotPayload } from '../../modules/competitors/traffic-snapshots.processor.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from './auth.js';
import { assertNotFoundEnvelope } from './cross-account.js';
import { installSweepHolders, removeSweepHolders } from './cross-account.sweep-support.js';
import { startMemoryMongo, stopMemoryMongo } from './mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres } from './postgres.js';
import { RESOURCE_OWNERSHIP_CASES } from './resource-ownership.cases.js';

let app: Express;
let owner: TestUser;
let stranger: TestUser;
let teammate: TestUser;

beforeAll(async () => {
    await startMemoryMongo();
    installSweepHolders(await startTestPostgres());
    installTestAuth();
    app = createApp();
    owner = await signupVerifiedUser(app, { email: 'route-proof-owner@example.test' });
    stranger = await signupVerifiedUser(app, { email: 'route-proof-stranger@example.test' });
    teammate = await signupVerifiedUser(app, { email: 'route-proof-member@example.test' });
});
afterAll(async () => {
    uninstallTestAuth();
    removeSweepHolders();
    await stopTestPostgres();
    await stopMemoryMongo();
});

describe('registered HTTP resource ownership proofs', () => {
    it.each(RESOURCE_OWNERSHIP_CASES)('$key', async (proof) => {
        const db = getTestDb();
        let id: string;
        if (proof.resource === 'member') {
            const rows = await db.insert(teamMembers).values({
                teamId: owner.id, userId: teammate.id, email: `${randomUUID()}@example.test`,
                role: 'member', siteAccessMode: 'all', invitedBy: owner.id,
                inviteTokenHash: randomUUID(), acceptedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
            }).returning({ id: teamMembers.id });
            id = rows[0]!.id;
        } else {
            const capturedAt = new Date('2026-10-16T12:00:00Z');
            const retainedOps = { traffic: true, rankOverview: true, history: true };
            const run = await TrafficSnapshotRun.create({
                accountId: owner.id, targetDomain: 'private-owner.example',
                inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 1 },
                status: 'succeeded', retainedOps, completedAt: capturedAt,
            });
            id = String(run._id);
            const payload = buildTrafficSnapshotPayload({
                traffic: [{ domain: run.targetDomain, monthlyOrganicVisits: 1234, topCountries: [] }],
                rankOverview: { domain: run.targetDomain, rank: 42, keywordsCount: 8, estimatedMonthlyOrganicVisits: 1234 },
                history: { domain: run.targetDomain, points: [] }, retainedOps,
                retryableFailures: { traffic: null, rankOverview: null, history: null },
            }, run, capturedAt);
            await db.insert(trafficSnapshots).values({ accountId: owner.id, runId: id, targetDomain: run.targetDomain, payload, capturedAt });
        }
        const ask = (resourceId: string, cookie: string | null) => {
            const call = request(app)[proof.method](proof.path.replace(':id', resourceId)).set('Origin', env.CLIENT_URL);
            if (cookie !== null) call.set('Cookie', cookie);
            return proof.resource === 'member' ? call.send(proof.body) : call;
        };
        const strangerResponse = await ask(id, stranger.cookie);
        assertNotFoundEnvelope(strangerResponse, `${proof.key} as a stranger`);
        expect(strangerResponse.text).not.toContain('private-owner.example');
        expect((await ask(id, null)).status, `${proof.key} anonymous`).toBe(401);
        const missingId = proof.resource === 'member' ? randomUUID() : new Types.ObjectId().toHexString();
        assertNotFoundEnvelope(await ask(missingId, owner.cookie), `${proof.key} missing resource`);
        if (proof.resource === 'member') {
            const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
            expect(rows[0]).toMatchObject({ teamId: owner.id, role: 'member', siteAccessMode: 'all' });
        }
        const ownerResponse = await ask(id, owner.cookie);
        expect(ownerResponse.status, `${proof.key} owner`).toBe(200);
        if (proof.resource === 'member') {
            expect(ownerResponse.body.member).toMatchObject({ id, role: 'admin' });
            const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
            expect(rows[0]?.role).toBe('admin');
        } else {
            expect(ownerResponse.body).toMatchObject({ id, targetDomain: 'private-owner.example', snapshot: { payload: { monthlyOrganicVisits: { value: 1234 } } } });
        }
    });
});
