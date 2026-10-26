import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { createApiKey } from '../../modules/api-keys/api-keys.service.js';
import { AuditRun } from '../../modules/audits/audit-run.model.js';
import { writeReportSnapshot } from '../../modules/audits/report.service.js';
import { makeAuditResult } from '../../modules/audits/rules/fixtures.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from './auth.js';
import { routeContract } from './cross-account.registry.js';
import { fillChildren, installSweepHolders, removeSweepHolders } from './cross-account.sweep-support.js';
import { findForbiddenKeys } from './dto-key-scan.js';
import { startMemoryMongo, stopMemoryMongo } from './mongo.js';
import { startTestPostgres, stopTestPostgres } from './postgres.js';
import { siteWithKeywords } from './resource-fixtures.js';
import { listRoutes, routeKey } from './route-inventory.js';

let app: Express;
let owner: TestUser;
let siteId: string;
let runId: string;
let privateApiKey: string;

beforeAll(async () => {
    await startMemoryMongo();
    const db = await startTestPostgres();
    installSweepHolders(db);
    installTestAuth();
    app = createApp();
    owner = await signupVerifiedUser(app, { email: 'response-scan@example.test' });
    privateApiKey = (await createApiKey(db as never, { accountId: owner.id, name: 'Response scan metadata' })).key;
    siteId = (await siteWithKeywords(owner.id)).siteId;
    const run = await AuditRun.create({ accountId: owner.id, siteId, pageCap: 10, status: 'succeeded', vendorTaskId: 'private-provider-task' });
    runId = String(run._id);
    await writeReportSnapshot({ runId, siteId, accountId: owner.id, result: makeAuditResult() });
});
afterAll(async () => {
    uninstallTestAuth();
    removeSweepHolders();
    await stopTestPostgres();
    await stopMemoryMongo();
});

describe('browser response credential contract', () => {
    it('scans every account or site GET that needs no child resource id', async () => {
        const routes = listRoutes(app).filter((route) => route.method === 'GET' && (routeContract(route) === 'cookie' || route.path === '/api/security/csrf-token') && route.params.every((name) => name === 'siteId'));
        expect(routes.length).toBeGreaterThan(40);
        const failures: string[] = [];
        let successful = 0;
        for (const route of routes) {
            const response = await request(app).get(fillChildren(route.path, siteId, 'objectId')).set('Origin', env.CLIENT_URL).set('Cookie', owner.cookie);
            if (response.status === 200) successful++;
            if (response.status === 500) failures.push(`${routeKey(route)}: server error ${JSON.stringify(response.body)}`);
            const keys = findForbiddenKeys(response.body);
            if (keys.length > 0) failures.push(`${routeKey(route)}: ${keys.join(', ')}`);
            expect(response.text, routeKey(route)).not.toContain(privateApiKey);
        }
        expect(failures).toEqual([]);
        expect(successful).toBeGreaterThan(35);
    }, 300_000);

    it('reads seeded audit, report and keyword DTOs without internal provider fields', async () => {
        for (const path of [
            `/api/sites/${siteId}/audits`, `/api/audits/${runId}`, `/api/audits/${runId}/report`,
            `/api/sites/${siteId}/keywords`, `/api/users/${owner.id}`,
        ]) {
            const response = await request(app).get(path).set('Origin', env.CLIENT_URL).set('Cookie', owner.cookie);
            expect(response.status, path).toBe(200);
            expect(findForbiddenKeys(response.body), path).toEqual([]);
            expect(response.text, path).not.toContain('private-provider-task');
        }
    });

    it('keeps native session transport enrolled in the Better Auth framework contract', async () => {
        expect(routeContract({ method: 'GET', path: '/api/auth/*' })).toBe('framework');
        for (const path of ['/api/auth/get-session', '/api/auth/list-sessions']) {
            const response = await request(app).get(path).set('Origin', env.CLIENT_URL).set('Cookie', owner.cookie);
            expect(response.status, path).toBe(200);
        }
    });
});
