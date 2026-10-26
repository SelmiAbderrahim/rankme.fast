import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { Site } from '../../modules/sites/sites.model.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from './auth.js';
import { routeContract } from './cross-account.registry.js';
import { assertNotFoundEnvelope, type HttpMethod } from './cross-account.js';
import { fillChildren, ID_SHAPES, installSweepHolders, removeSweepHolders } from './cross-account.sweep-support.js';
import { startMemoryMongo, stopMemoryMongo } from './mongo.js';
import { startTestPostgres, stopTestPostgres } from './postgres.js';
import { listRoutes, routeKey } from './route-inventory.js';

let app: Express;
let owner: TestUser;
let stranger: TestUser;
let siteId: string;

beforeAll(async () => {
    await startMemoryMongo();
    installSweepHolders(await startTestPostgres());
    installTestAuth();
    app = createApp();
    owner = await signupVerifiedUser(app, { email: 'site-sweep-owner@example.test' });
    stranger = await signupVerifiedUser(app, { email: 'site-sweep-stranger@example.test' });
    siteId = String((await Site.create({ accountId: owner.id, url: 'https://owned-sweep.example', domain: 'owned-sweep.example' }))._id);
});
afterAll(async () => {
    uninstallTestAuth();
    removeSweepHolders();
    await stopTestPostgres();
    await stopMemoryMongo();
});

describe('mounted route authentication and site ownership', () => {
    it('returns the standard 404 to a stranger on every nested site route', async () => {
        const routes = listRoutes(app).filter((route) => route.path.startsWith('/api/sites/:siteId/'));
        expect(routes.length).toBeGreaterThan(100);
        const failures: string[] = [];
        for (const route of routes) {
            const ask = (shape: (typeof ID_SHAPES)[number]) => request(app)[route.method.toLowerCase() as HttpMethod](fillChildren(route.path, siteId, shape)).set('Origin', env.CLIENT_URL).set('Cookie', stranger.cookie);
            let response = await ask(ID_SHAPES[0]!);
            for (const shape of ID_SHAPES.slice(1)) {
                if (response.status === 400) response = await ask(shape);
            }
            try { assertNotFoundEnvelope(response, routeKey(route)); }
            catch (error) { failures.push((error as Error).message); }
        }
        expect(failures).toEqual([]);
    }, 300_000);

    it('requires 401 anonymously on every cookie or bearer product route', async () => {
        const routes = listRoutes(app).filter((route) => ['cookie', 'bearer'].includes(routeContract(route) ?? ''));
        expect(routes.length).toBeGreaterThan(250);
        const failures: string[] = [];
        for (const route of routes) {
            const response = await request(app)[route.method.toLowerCase() as HttpMethod](fillChildren(route.path, siteId, 'objectId')).set('Origin', env.CLIENT_URL);
            if (response.status !== 401) failures.push(`${routeKey(route)}: expected 401, got ${response.status} ${JSON.stringify(response.body)}`);
        }
        expect(failures).toEqual([]);
    }, 300_000);

    it('returns the standard 404 for unknown child resources under an owned site', async () => {
        const routes = listRoutes(app).filter((route) => route.method === 'GET' && route.path.startsWith('/api/sites/:siteId/') && route.params.some((name) => name !== 'siteId' && name !== 'domain'));
        expect(routes.length).toBeGreaterThan(5);
        const failures: string[] = [];
        for (const route of routes) {
            const ask = (shape: (typeof ID_SHAPES)[number]) => request(app).get(fillChildren(route.path, siteId, shape)).set('Origin', env.CLIENT_URL).set('Cookie', owner.cookie);
            let response = await ask(ID_SHAPES[0]!);
            for (const shape of ID_SHAPES.slice(1)) {
                if (response.status === 400) response = await ask(shape);
            }
            try { assertNotFoundEnvelope(response, routeKey(route)); }
            catch (error) { failures.push((error as Error).message); }
        }
        expect(failures).toEqual([]);
    }, 300_000);
});
