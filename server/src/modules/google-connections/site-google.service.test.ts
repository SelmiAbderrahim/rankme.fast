import { describe, expect, it } from 'vitest';
import {
  currentGa4BindingGeneration,
  currentGscBindingGeneration,
  matchGa4PropertyForSite,
  matchGscPropertyForSite,
  siteGoogleTestables,
} from './site-google.service.js';

describe('site Google resource matching', () => {
  it('prefers an exact GSC domain property over parent-domain coverage', () => {
    expect(
      matchGscPropertyForSite('https://shop.example.com', 'shop.example.com', [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
        { siteUrl: 'sc-domain:shop.example.com', permissionLevel: 'siteOwner' },
      ]),
    ).toEqual({
      kind: 'matched',
      value: {
        siteUrl: 'sc-domain:shop.example.com',
        permissionLevel: 'siteOwner',
      },
    });
  });

  it('matches a root URL-prefix property and ignores unverified properties', () => {
    expect(
      matchGscPropertyForSite('https://example.com', 'example.com', [
        {
          siteUrl: 'sc-domain:example.com',
          permissionLevel: 'siteUnverifiedUser',
        },
        { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
      ]),
    ).toMatchObject({
      kind: 'matched',
      value: { siteUrl: 'https://example.com/' },
    });
  });

  it('does not guess when equally ranked GSC resources are duplicated', () => {
    expect(
      matchGscPropertyForSite('https://example.com', 'example.com', [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' },
      ]),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('matches GA4 only on an exact normalized web-stream origin', () => {
    expect(
      matchGa4PropertyForSite('https://example.com/', [
        {
          property: { propertyId: 'properties/1', displayName: 'Production' },
          streams: [
            {
              streamId: 'properties/1/dataStreams/1',
              displayName: 'Web',
              defaultUri: 'https://example.com',
            },
          ],
        },
      ]),
    ).toEqual({
      kind: 'matched',
      value: {
        property: { propertyId: 'properties/1', displayName: 'Production' },
        matchedUri: 'https://example.com',
      },
    });
  });

  it('does not guess when two GA4 properties claim the same origin', () => {
    expect(
      matchGa4PropertyForSite('https://example.com', [
        {
          property: { propertyId: 'properties/1', displayName: 'One' },
          streams: [{ streamId: 'streams/1', displayName: 'One', defaultUri: 'https://example.com' }],
        },
        {
          property: { propertyId: 'properties/2', displayName: 'Two' },
          streams: [{ streamId: 'streams/2', displayName: 'Two', defaultUri: 'https://example.com/' }],
        },
      ]),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('rejects invalid and non-root GSC resources without guessing', () => {
    expect(matchGscPropertyForSite('not a site url', 'example.com', [
      { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
    ])).toEqual({ kind: 'no_match' });
    expect(matchGscPropertyForSite('https://example.com', 'example.com', [
      { siteUrl: 'sc-domain:other.test', permissionLevel: 'siteOwner' },
      { siteUrl: 'not a property', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/path', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/?query=yes', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/#hash', permissionLevel: 'siteOwner' },
    ])).toEqual({ kind: 'no_match' });
  });

  it('rejects GA4 matching for invalid origins and invalid stream URIs', () => {
    expect(matchGa4PropertyForSite('not a site url', [])).toEqual({ kind: 'no_match' });
    expect(matchGa4PropertyForSite('https://example.com', [{
      property: { propertyId: 'properties/1', displayName: 'Bad stream' },
      streams: [{ streamId: 'streams/1', displayName: 'Bad', defaultUri: 'not a url' }],
    }])).toEqual({ kind: 'no_match' });
  });

  it('resolves current binding generations without changing legacy identities', () => {
    expect(currentGscBindingGeneration({ gscPropertyUrl: null } as never)).toBeNull();
    expect(currentGscBindingGeneration({
      gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: null,
    } as never)).toBe('legacy');
    expect(currentGscBindingGeneration({
      gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: 'current',
    } as never)).toBe('current');
    expect(currentGa4BindingGeneration({ ga4PropertyId: null } as never)).toBeNull();
    expect(currentGa4BindingGeneration({
      ga4PropertyId: 'properties/1', ga4BindingGenerationId: null,
    } as never)).toBe('legacy');
    expect(currentGa4BindingGeneration({
      ga4PropertyId: 'properties/1', ga4BindingGenerationId: 'current',
    } as never)).toBe('current');
  });

  it('normalizes legacy status and usage fallbacks', () => {
    expect(siteGoogleTestables.gscStatus({ gscPropertyUrl: null } as never)).toBe('unbound');
    expect(siteGoogleTestables.gscStatus({
      gscPropertyUrl: null, googleAutoMatch: { gscStatus: 'queued' },
    } as never)).toBe('queued');
    expect(siteGoogleTestables.ga4Status({ ga4PropertyId: null } as never)).toBe('unbound');
    expect(siteGoogleTestables.ga4Status({
      ga4PropertyId: null, googleAutoMatch: { ga4Status: 'queued' },
    } as never)).toBe('queued');
    expect(siteGoogleTestables.usagePayload({
      _id: 'site-1', domain: 'example.com', displayName: undefined,
    } as never)).toEqual({
      siteId: 'site-1', domain: 'example.com', displayName: '',
    });
  });
});
