import express, { type Express } from 'express';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { Site } from '../../modules/sites/sites.model.js';
import { installTestAuth, uninstallTestAuth } from './auth.js';
import { assertNotFoundEnvelope, coverageOf, crossAccount404, fillPath, findStaleRegistryEntries, findUnregisteredRoutes, type CrossAccountCase } from './cross-account.js';
import type { CrossAccountCoverage } from './cross-account.registry.js';
import { fillChildren, ID_SHAPES, installSweepHolders, removeSweepHolders } from './cross-account.sweep-support.js';
import { startMemoryMongo, stopMemoryMongo } from './mongo.js';
import { startTestPostgres, stopTestPostgres } from './postgres.js';
import type { InventoryRoute } from './route-inventory.js';

const envelope = { error: { message: 'Not found.', code: 'NOT_FOUND', messageKey: 'errors.notFound' } };
let app: Express;

beforeAll(async () => {
    await startMemoryMongo();
    installSweepHolders(await startTestPostgres());
    installTestAuth();
    app = express();
    app.get('/broken/:mode/:id', (req, res) => {
        const mode = req.params.mode;
        if (mode === 'leak') return void res.status(200).json({ leaked: true });
        if (mode === 'forbidden') return void res.status(403).json({});
        if (mode === 'bare') return void res.status(404).send('missing');
        if (!req.headers.cookie) return void res.status(mode === 'anonymous' ? 200 : 401).json({});
        if (mode === 'random' && req.params.id !== 'KNOWN') return void res.status(200).json({ leaked: true });
        res.status(404).json(envelope);
    });
    app.use(createApp());
});

afterAll(async () => {
    uninstallTestAuth();
    removeSweepHolders();
    await stopTestPostgres();
    await stopMemoryMongo();
});

describe('cross-account denial helper', () => {
    it('proves stranger, anonymous and missing-resource answers with real Better Auth sessions', async () => {
        await crossAccount404({
            app, name: 'GET /api/sites/:id',
            create: async (owner) => String((await Site.create({ accountId: owner.id, url: 'https://owned.example', domain: 'owned.example' }))._id),
            call: (id) => ({ method: 'get', url: `/api/sites/${id}` }),
        });
    });
    it.each([
        ['leak', /as account B: expected 404, got 200/u],
        ['forbidden', /expected 404, got 403/u],
        ['bare', /standard error envelope/u],
        ['anonymous', /unauthenticated: expected 401, got 200/u],
        ['random', /random well-formed id: expected 404, got 200/u],
    ])('rejects a route with a %s response', async (mode, message) => {
        await expect(crossAccount404({ app, name: mode, create: async () => 'KNOWN', call: (id) => ({ method: 'get', url: `/broken/${mode}/${id}` }), randomId: () => 'RANDOM' })).rejects.toThrow(message);
    });
    it('sends request bodies and defaults to random ObjectIds', async () => {
        const seen: string[] = [];
        const testCase: CrossAccountCase = {
            app, name: 'POST /api/sites/:id/pause', create: async () => '000000000000000000000001',
            call: (id) => { seen.push(id); return { method: 'post', url: `/api/sites/${id}/pause`, body: {} }; },
        };
        await crossAccount404(testCase);
        expect(seen[1]).toMatch(/^[a-f0-9]{24}$/u);
        expect(seen[1]).not.toBe(seen[0]);
    });
});

describe('standard not-found response', () => {
    const response = (status: number, body: unknown) => ({ status, body }) as Response;
    it('accepts the complete envelope', () => expect(() => assertNotFoundEnvelope(response(404, envelope), 'route')).not.toThrow());
    it.each([{}, { error: { code: 'c', messageKey: 'k' } }, { error: { message: 'm', messageKey: 'k' } }, { error: { message: 'm', code: 'c' } }])('rejects an incomplete envelope %j', (body) => {
        expect(() => assertNotFoundEnvelope(response(404, body), 'route')).toThrow(/standard error envelope/u);
    });
    it('rejects an incorrect status', () => expect(() => assertNotFoundEnvelope(response(200, envelope), 'route')).toThrow(/expected 404/u));
});

describe('route enrollment helpers', () => {
    const route = (path: string): InventoryRoute => ({ method: 'GET', path, params: [] });
    const registry: Record<string, CrossAccountCoverage> = { 'GET /api/items/:id': { kind: 'test', file: 'modules/items/items.test.ts' } };
    it('accepts registered routes and automatic site sweeps but reports unknown routes', () => {
        expect(coverageOf(route('/api/items/:id'), registry)).toEqual(registry['GET /api/items/:id']);
        expect(coverageOf(route('/api/sites/:siteId/items/:id'), registry)).toBe('site-lease');
        expect(coverageOf(route('/api/sites/:siteId'), registry)).toBeNull();
        expect(findUnregisteredRoutes([route('/api/items/:id'), route('/api/unknown/:id')], registry)).toEqual([route('/api/unknown/:id')]);
        expect(findStaleRegistryEntries([], registry)).toEqual(['GET /api/items/:id']);
        expect(findStaleRegistryEntries([route('/api/items/:id')], registry)).toEqual([]);
    });
    it('uses the product registry by default', () => {
        expect(coverageOf({ method: 'DELETE', path: '/api/keywords/:id' })).toMatchObject({ kind: 'test' });
        expect(findUnregisteredRoutes([route('/unknown')])).toHaveLength(1);
        expect(findStaleRegistryEntries([]).length).toBeGreaterThan(0);
    });
    it('fills independent child identifiers in every supported shape', () => {
        expect(fillPath('/api/sites/:siteId/items/:id', 'SITE')).toMatch(/^\/api\/sites\/SITE\/items\/[a-f0-9]{24}$/u);
        const patterns = [/^[a-f0-9]{24}$/u, /^[a-f0-9-]{36}$/u, /^[a-f0-9]{64}$/u, /^[\w-]{43}$/u];
        for (const [index, shape] of ID_SHAPES.entries()) {
            const path = fillChildren('/api/sites/:siteId/items/:id/children/:childId', 'SITE', shape);
            const segments = path.split('/');
            expect(segments[3]).toBe('SITE');
            expect(segments[5]).toMatch(patterns[index]!);
            expect(segments[7]).not.toBe(segments[5]);
        }
    });
});
