import express, { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { listIdParamRoutes, listRoutes, routeKey } from './route-inventory.js';

describe('Express route inventory', () => {
    it('walks nested parameter mounts, aliases and root mounts without duplicates', () => {
        const app = express();
        const child = Router().get('/:id', (_req, res) => res.end());
        const router = Router();
        router.get('/', (_req, res) => res.end());
        router.post(['/items/:itemId', '/alias'], (_req, res) => res.end());
        router.use('/nested', child);
        app.use('/api/sites/:siteId', router);
        app.use('/', Router().get('/plain', (_req, res) => res.end()));
        app.get('/plain', (_req, res) => res.end());
        app.get('/', (_req, res) => res.end());
        expect(listRoutes(app).map(routeKey)).toEqual([
            'GET /',
            'GET /api/sites/:siteId',
            'POST /api/sites/:siteId/alias',
            'POST /api/sites/:siteId/items/:itemId',
            'GET /api/sites/:siteId/nested/:id',
            'GET /plain',
        ]);
        expect(listRoutes(app).find((route) => route.path.endsWith('/items/:itemId'))?.params).toEqual(['siteId', 'itemId']);
        expect(listIdParamRoutes(app)).toHaveLength(4);
    });

    it('accepts bare routers and empty apps', () => {
        expect(listRoutes(express())).toEqual([]);
        const router = Router().get('/domain/:domain', (_req, res) => res.end());
        expect(listRoutes(router).map(routeKey)).toEqual(['GET /domain/:domain']);
        expect(listIdParamRoutes(router)).toEqual([]);
    });
});
