import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { ACCOUNT_ROUTES, BEARER_ROUTES, CROSS_ACCOUNT_REGISTRY, PUBLIC_ROUTE_CONTRACTS, routeContract } from './cross-account.registry.js';
import { findStaleRegistryEntries, findUnregisteredRoutes } from './cross-account.js';
import { listIdParamRoutes, listRoutes, routeKey } from './route-inventory.js';
import { findInvalidOwnershipProofs, RESOURCE_OWNERSHIP_CASES, RESOURCE_OWNERSHIP_PROOF_FILE } from './resource-ownership.cases.js';

const app = createApp();
const idRoutes = listIdParamRoutes(app);

describe('product route ownership enrollment', () => {
    it('links team updates and both traffic detail aliases to exact executable HTTP proofs', () => {
        expect(findInvalidOwnershipProofs(CROSS_ACCOUNT_REGISTRY)).toEqual([]);
        for (const proof of RESOURCE_OWNERSHIP_CASES) {
            expect(`${proof.method.toUpperCase()} ${proof.path}`).toBe(proof.key);
            expect(CROSS_ACCOUNT_REGISTRY[proof.key], proof.key).toMatchObject({ file: RESOURCE_OWNERSHIP_PROOF_FILE, proof: proof.key });
        }
    });
    it('enrolls every resource-id route and removes deleted registry entries', () => {
        expect(findUnregisteredRoutes(idRoutes).map(routeKey)).toEqual([]);
        expect(findStaleRegistryEntries(idRoutes)).toEqual([]);
    });
    it('assigns every mounted route an explicit authentication contract', () => {
        expect(listRoutes(app).filter((route) => routeContract(route) === null).map(routeKey)).toEqual([]);
        expect(routeContract({ method: 'GET', path: '/api/new-product' })).toBeNull();
        const live = new Set(listRoutes(app).map(routeKey));
        expect([...ACCOUNT_ROUTES, ...BEARER_ROUTES, ...Object.keys(PUBLIC_ROUTE_CONTRACTS)].filter((key) => !live.has(key))).toEqual([]);
    });
    it('links ownership assertions and documented public contracts to existing tests', () => {
        const failures: string[] = [];
        for (const [key, coverage] of Object.entries(CROSS_ACCOUNT_REGISTRY)) {
            const path = resolve(import.meta.dirname, '../..', coverage.file);
            if (!existsSync(path)) failures.push(`${key}: missing ${coverage.file}`);
            if (coverage.kind === 'test' && coverage.proof !== undefined) {
                expect(coverage.file, key).toBe(RESOURCE_OWNERSHIP_PROOF_FILE);
                expect(RESOURCE_OWNERSHIP_CASES.some((proof) => proof.key === key && proof.key === coverage.proof), `${key}: missing executable ownership case`).toBe(true);
            }
            if (coverage.kind === 'public') expect(coverage.reason.length, key).toBeGreaterThan(20);
        }
        expect(failures).toEqual([]);
        for (const [key, contract] of Object.entries(PUBLIC_ROUTE_CONTRACTS)) {
            expect(contract.reason.length, key).toBeGreaterThan(20);
            expect(existsSync(resolve(import.meta.dirname, '../..', contract.file)), `${key}: missing ${contract.file}`).toBe(true);
        }
    });
});
