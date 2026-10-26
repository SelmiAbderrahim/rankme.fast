import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { inferNewSiteMarket } from './sites.service.js';

vi.mock('../../shared/security/index.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readSiteLanguageHead: vi.fn().mockResolvedValue('<html lang="de-DE"><head></head>'),
}));

const originalNodeEnv = env.NODE_ENV;
const originalFakeProviders = env.ALLOW_FAKE_PROVIDERS;
afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.ALLOW_FAKE_PROVIDERS = originalFakeProviders;
});

describe('site market page-language evidence', () => {
    it('uses bounded page language metadata when production probing is enabled', async () => {
        env.NODE_ENV = 'production';
        env.ALLOW_FAKE_PROVIDERS = false;
        expect(await inferNewSiteMarket('https://example.com/', 'example.com', null))
            .toMatchObject({ locationCode: 2276, languageCode: 'de', basis: 'page', source: 'inferred' });
    });
});
