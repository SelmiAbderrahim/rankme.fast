import { describe, expect, it } from 'vitest';
import { findInvalidOwnershipProofs, RESOURCE_OWNERSHIP_CASES, RESOURCE_OWNERSHIP_PROOF_FILE } from './resource-ownership.cases.js';

const valid = () => Object.fromEntries(RESOURCE_OWNERSHIP_CASES.map((proof) => [proof.key, { file: RESOURCE_OWNERSHIP_PROOF_FILE, proof: proof.key }]));

describe('executable HTTP ownership proof enrollment', () => {
    it('accepts exactly linked executable cases', () => {
        expect(findInvalidOwnershipProofs(valid())).toEqual([]);
    });
    it('rejects the original file-only links even when their source contains unrelated 404 tests', () => {
        const original = Object.fromEntries(RESOURCE_OWNERSHIP_CASES.map((proof) => [proof.key, {
            file: proof.resource === 'member' ? 'modules/team/team.test.ts' : 'modules/competitors/traffic-snapshots.service.test.ts',
        }]));
        expect(findInvalidOwnershipProofs(original)).toEqual(RESOURCE_OWNERSHIP_CASES.map((proof) => proof.key));
    });
    it('rejects a missing entry or a case identifier for a different route', () => {
        expect(findInvalidOwnershipProofs({})).toHaveLength(4);
        const links = valid();
        links[RESOURCE_OWNERSHIP_CASES[0].key]!.proof = RESOURCE_OWNERSHIP_CASES[1].key;
        expect(findInvalidOwnershipProofs(links)).toEqual([RESOURCE_OWNERSHIP_CASES[0].key]);
    });
});
