/**
 * Client runtime for observation contracts. Mirrors the server shape and
 * asserts parity through a shared canonical fixture (see observations.test).
 */

import { z } from 'zod';
import type {
  CoverageNoteKey,
  Freshness,
  ObservationMeta,
  SiteMarket,
  SourceKind,
} from './types';

export const SOURCE_KINDS = [
  'first_party',
  'provider_observation',
  'estimate',
  'ai_interpretation',
] as const satisfies readonly SourceKind[];

export const FRESHNESS_STATES = [
  'fresh',
  'stale',
  'partial',
  'blocked',
  'failed',
  'unknown',
] as const satisfies readonly Freshness[];

export const DEVICE_STATES = ['desktop', 'mobile', 'all'] as const;

/**
 * Same allowlist as server-side SOURCE_LABELS. A regression test asserts
 * the two constants stay in lock-step.
 */
export const SOURCE_LABELS = [
  'dataforseo',
  'firecrawl',
  'google_search_console',
  'google_analytics_4',
  'google_pagespeed',
  'google_crux',
  'ai_visibility',
  'internal_crawl',
  'rankme_rules',
  'rankme_ai',
] as const;

export const COVERAGE_NOTE_KEYS = [
  'observations.coverage.freshCache',
  'observations.coverage.staleCache',
  'observations.coverage.legacyLocation',
  'observations.coverage.unknownMarket',
  'observations.coverage.unsupportedAiMarket',
  'observations.coverage.unsupportedAiEngine',
  'observations.coverage.providerTimeout',
  'observations.coverage.providerQuota',
  'observations.coverage.providerMalformed',
  'observations.coverage.providerUnavailable',
  'observations.coverage.partialResult',
  'observations.coverage.blockedByRobots',
  'observations.coverage.blockedByZdr',
  'observations.coverage.blockedByAuth',
  'observations.coverage.firstPartyUnavailable',
  'observations.coverage.gscDisconnected',
  'observations.coverage.ga4Disconnected',
  'observations.coverage.aiInterpretation',
  'observations.coverage.estimateOnly',
  'observations.coverage.neverObserved',
  // Provider-index ordinal, not a live shelf
  // position. Mirrors the server enum in `shared/observations/observations.ts`.
  'observations.coverage.providerIndexRanking',
] as const;

/**
 * Client picker mapping — kept identical to the server's authoritative map.
 * Parity test asserts equivalence at build time.
 */
export const DATAFORSEO_LOCATION_ISO: Readonly<Record<number, string>> =
  Object.freeze({
    2840: 'US',
    2784: 'AE',
    2032: 'AR',
    2040: 'AT',
    2036: 'AU',
    2056: 'BE',
    2854: 'BF',
    2048: 'BH',
    2068: 'BO',
    2124: 'CA',
    2756: 'CH',
    2384: 'CI',
    2152: 'CL',
    2120: 'CM',
    2170: 'CO',
    2188: 'CR',
    2196: 'CY',
    2276: 'DE',
    2012: 'DZ',
    2218: 'EC',
    2818: 'EG',
    2724: 'ES',
    2250: 'FR',
    2826: 'GB',
    2288: 'GH',
    2300: 'GR',
    2320: 'GT',
    2360: 'ID',
    2372: 'IE',
    2376: 'IL',
    2356: 'IN',
    2400: 'JO',
    2404: 'KE',
    2116: 'KH',
    2398: 'KZ',
    2144: 'LK',
    2504: 'MA',
    2492: 'MC',
    2104: 'MM',
    2470: 'MT',
    2484: 'MX',
    2458: 'MY',
    2566: 'NG',
    2558: 'NI',
    2554: 'NZ',
    2591: 'PA',
    2604: 'PE',
    2608: 'PH',
    2586: 'PK',
    2600: 'PY',
    2682: 'SA',
    2702: 'SG',
    2686: 'SN',
    2222: 'SV',
    2788: 'TN',
    2804: 'UA',
    2858: 'UY',
    2862: 'VE',
    2704: 'VN',
    2710: 'ZA',
  });

export const UNKNOWN_COUNTRY = 'ZZ' as const;

const COUNTRY_RE = /^[A-Z]{2}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const siteMarketSchema = z
  .object({
    country: z
      .string()
      .transform((v) => v.toUpperCase())
      .refine((v) => COUNTRY_RE.test(v), 'country must be ISO 3166-1 alpha-2'),
    region: z.string().min(1).max(80).nullable(),
    city: z.string().min(1).max(80).nullable(),
    language: z
      .string()
      .transform((v) => v.toLowerCase())
      .refine((v) => LANGUAGE_RE.test(v), 'language must be BCP-47-compatible'),
    device: z.enum(DEVICE_STATES),
  })
  .strict();

const isoDateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'observedAt must be ISO 8601');

export const observationMetaSchema = z
  .object({
    sourceKind: z.enum(SOURCE_KINDS),
    sourceLabel: z.enum(SOURCE_LABELS).nullable(),
    observedAt: isoDateSchema,
    freshUntil: isoDateSchema.nullable(),
    freshness: z.enum(FRESHNESS_STATES),
    market: siteMarketSchema.nullable(),
    sampleCount: z.number().int().positive(),
    coverageNoteKey: z.enum(COVERAGE_NOTE_KEYS).nullable(),
  })
  .strict();

/** Parse an ObservationMeta received from the server. Throws on drift. */
export function parseObservationMeta(input: unknown): ObservationMeta {
  return observationMetaSchema.parse(input);
}

/** Type-narrowing helper mirroring the server. */
export function isCoverageNoteKey(value: unknown): value is CoverageNoteKey {
  return (
    typeof value === 'string' &&
    (COVERAGE_NOTE_KEYS as readonly string[]).includes(value)
  );
}

/** Convenience for tests and consumers building an SiteMarket by hand. */
export function parseSiteMarket(input: unknown): SiteMarket {
  return siteMarketSchema.parse(input);
}
