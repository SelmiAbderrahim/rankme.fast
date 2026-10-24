import { describe, expect, it } from 'vitest';
import { findForbiddenKeys } from './dto-key-scan.js';

describe('browser response secret-key scanner', () => {
    it('finds nested credentials, hashes and provider identifiers, including snake-case keys', () => {
        expect(findForbiddenKeys({
            rows: [{ sessionToken: 'x', passwordHash: 'y' }, { providerTaskId: 'z', vendor_id: 'v', api_key: 'k', credentialRef: 'c' }],
            clientSecret: 's',
        })).toEqual([
            '$.rows[0].sessionToken', '$.rows[0].passwordHash', '$.rows[1].providerTaskId',
            '$.rows[1].vendor_id', '$.rows[1].api_key', '$.rows[1].credentialRef', '$.clientSecret',
        ]);
    });

    it('allows only the exact public key prefix and CSRF field names', () => {
        expect(findForbiddenKeys({ apiKeyPrefix: 'rmf_a', csrfToken: 'public-anti-forgery', ok: true, nothing: null })).toEqual([]);
        expect(findForbiddenKeys({ apiKeyPrefixes: [], csrfTokens: [], mustChangePassword: 'secret' })).toEqual(['$.apiKeyPrefixes', '$.csrfTokens', '$.mustChangePassword']);
        expect(findForbiddenKeys(['plain', 1, null])).toEqual([]);
    });

    it('accepts the public account-state boolean and public-key metadata collections only', () => {
        expect(findForbiddenKeys({ mustChangePassword: false, apiKeys: [{ id: 'id', name: 'public metadata', prefix: 'rmf_abcdefgh', scopes: null }] })).toEqual([]);
        expect(findForbiddenKeys({ apiKeys: [] })).toEqual([]);
        expect(findForbiddenKeys({ apiKeys: 'secret' })).toEqual(['$.apiKeys']);
        expect(findForbiddenKeys({ apiKeys: ['secret'] })).toEqual(['$.apiKeys']);
        expect(findForbiddenKeys({ apiKeys: [null] })).toEqual(['$.apiKeys']);
        expect(findForbiddenKeys({ apiKeys: [[{ prefix: 'rmf_abcdefgh' }]] })).toEqual(['$.apiKeys']);
        expect(findForbiddenKeys({ apiKeys: [{ key: 'secret', keyHash: 'hash' }] })).toEqual(['$.apiKeys', '$.apiKeys[0].keyHash']);
        expect(findForbiddenKeys({ apiKeys: [{ scopes: { credentialRef: 'secret' } }] })).toEqual(['$.apiKeys[0].scopes.credentialRef']);
    });
});
