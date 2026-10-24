import type { Express } from 'express';
import { Types } from 'mongoose';
import request, { type Response } from 'supertest';
import { env } from '../../config/env.js';
import { signupVerifiedUser, type TestUser } from './auth.js';
import { CROSS_ACCOUNT_REGISTRY, type CrossAccountCoverage } from './cross-account.registry.js';
import { routeKey, type InventoryRoute } from './route-inventory.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export interface CrossAccountRequest { method: HttpMethod; url: string; body?: Record<string, unknown> }
export interface CrossAccountCase {
    app: Express;
    name: string;
    create(owner: TestUser): Promise<string>;
    call(id: string): CrossAccountRequest;
    randomId?: () => string;
}
interface ErrorEnvelope { error?: { message?: unknown; code?: unknown; messageKey?: unknown } }

export function assertNotFoundEnvelope(response: Response, label: string): void {
    if (response.status !== 404) throw new Error(`${label}: expected 404, got ${response.status} ${JSON.stringify(response.body)}`);
    const error = (response.body as ErrorEnvelope).error;
    if (typeof error?.message !== 'string' || typeof error.code !== 'string' || typeof error.messageKey !== 'string') {
        throw new Error(`${label}: 404 is not the standard error envelope: ${JSON.stringify(response.body)}`);
    }
}

async function send(app: Express, call: CrossAccountRequest, cookie: string | null): Promise<Response> {
    const base = request(app)[call.method](call.url).set('Origin', env.CLIENT_URL);
    const authenticated = cookie === null ? base : base.set('Cookie', cookie);
    return call.body === undefined ? authenticated : authenticated.send(call.body);
}

let accountCounter = 0;
/** Prove indistinguishable stranger/missing answers and require anonymous authentication. */
export async function crossAccount404(testCase: CrossAccountCase): Promise<void> {
    const stamp = `${Date.now()}-${++accountCounter}`;
    const owner = await signupVerifiedUser(testCase.app, { email: `resource-owner-${stamp}@example.test` });
    const stranger = await signupVerifiedUser(testCase.app, { email: `resource-stranger-${stamp}@example.test` });
    const call = testCase.call(await testCase.create(owner));
    assertNotFoundEnvelope(await send(testCase.app, call, stranger.cookie), `${testCase.name} as account B`);
    const anonymous = await send(testCase.app, call, null);
    if (anonymous.status !== 401) throw new Error(`${testCase.name} unauthenticated: expected 401, got ${anonymous.status}`);
    const random = testCase.randomId?.() ?? new Types.ObjectId().toHexString();
    assertNotFoundEnvelope(await send(testCase.app, testCase.call(random), stranger.cookie), `${testCase.name} with a random well-formed id`);
}

export function coverageOf(route: Pick<InventoryRoute, 'method' | 'path'>, registry: Readonly<Record<string, CrossAccountCoverage>> = CROSS_ACCOUNT_REGISTRY): CrossAccountCoverage | 'site-lease' | null {
    const registered = registry[routeKey(route)];
    if (registered) return registered;
    return route.path.startsWith('/api/sites/:siteId/') ? 'site-lease' : null;
}

export function findUnregisteredRoutes(routes: InventoryRoute[], registry: Readonly<Record<string, CrossAccountCoverage>> = CROSS_ACCOUNT_REGISTRY): InventoryRoute[] {
    return routes.filter((route) => coverageOf(route, registry) === null);
}

export function findStaleRegistryEntries(routes: InventoryRoute[], registry: Readonly<Record<string, CrossAccountCoverage>> = CROSS_ACCOUNT_REGISTRY): string[] {
    const live = new Set(routes.map(routeKey));
    return Object.keys(registry).filter((key) => !live.has(key));
}

export function fillPath(path: string, siteId: string): string {
    return path.replace(/:([A-Za-z0-9_]+)/gu, (_match, name: string) => name === 'siteId' ? siteId : new Types.ObjectId().toHexString());
}
