import { describe, expect, it } from 'vitest';
import { deriveSiteGoogleReadiness } from './google-readiness.js';
import { SCOPE_GA4, SCOPE_GSC } from './google-connections.schema.js';

const site = { url: 'https://example.com/', googleAutoMatch: { gscStatus: 'unbound', ga4Status: 'unbound' } };
const connection = { status: 'connected', scopes: [SCOPE_GSC, SCOPE_GA4] };

describe('site Google readiness', () => {
    it('distinguishes a missing credential from a missing property', () => {
        expect(deriveSiteGoogleReadiness(site, null)).toEqual({
            gsc: { status: 'not_connected', matching: false },
            ga4: { status: 'not_connected', matching: false },
        });
        expect(deriveSiteGoogleReadiness(site, connection)).toEqual({
            gsc: { status: 'no_property', matching: false },
            ga4: { status: 'no_property', matching: false },
        });
    });

    it('reports mismatched bindings and discovery progress from stored evidence', () => {
        expect(deriveSiteGoogleReadiness({
            ...site, gscPropertyUrl: 'https://other.example/', ga4PropertyId: 'properties/1',
            ga4MatchedWebStreamUri: 'https://other.example/',
            googleAutoMatch: { gscStatus: 'matching', ga4Status: 'queued' },
        }, connection)).toEqual({
            gsc: { status: 'property_mismatch', matching: true },
            ga4: { status: 'property_mismatch', matching: true },
        });
    });

    it('accepts a covered GSC property and a manually chosen GA4 property', () => {
        expect(deriveSiteGoogleReadiness({ ...site, gscPropertyUrl: 'sc-domain:example.com', ga4PropertyId: 'properties/1' }, connection)).toEqual({
            gsc: { status: 'ok', matching: false },
            ga4: { status: 'ok', matching: false },
        });
    });
});
