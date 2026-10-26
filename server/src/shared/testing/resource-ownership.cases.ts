/** Each case is executed by the route ownership suite, including its authenticated owner control. */
export const RESOURCE_OWNERSHIP_PROOF_FILE = 'shared/testing/resource-ownership.routes.test.ts';
export const RESOURCE_OWNERSHIP_CASES = [
    { key: 'PATCH /api/team/members/:id', resource: 'member', method: 'patch', path: '/api/team/members/:id', body: { role: 'admin', siteAccess: { mode: 'all' } } },
    { key: 'PATCH /api/team/members/:id/role', resource: 'member', method: 'patch', path: '/api/team/members/:id/role', body: { role: 'admin' } },
    { key: 'GET /api/competitors/traffic-snapshots/:id', resource: 'traffic', method: 'get', path: '/api/competitors/traffic-snapshots/:id' },
    { key: 'GET /api/sites/traffic-snapshots/:id', resource: 'traffic', method: 'get', path: '/api/sites/traffic-snapshots/:id' },
] as const;

/** File-only links cannot stand in for one of these exact executable route cases. */
export function findInvalidOwnershipProofs(registry: Readonly<Record<string, { file: string; proof?: string }>>): string[] {
    return RESOURCE_OWNERSHIP_CASES.filter((testCase) => {
        const linked = registry[testCase.key];
        return linked?.file !== RESOURCE_OWNERSHIP_PROOF_FILE || linked.proof !== testCase.key;
    }).map((testCase) => testCase.key);
}
