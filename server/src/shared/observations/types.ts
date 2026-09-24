/**
 * Shared observation contracts — provider-neutral market and provenance
 * metadata used across ranks, keyword-research, backlinks, AI visibility,
 * Content Intelligence, and audits/reports.
 *
 * These types are pure data shapes with NO runtime; the constructors,
 * validators, and serializers live in ./observations.ts.
 */
/** ISO 3166-1 alpha-2 country code, uppercase. `ZZ` = legacy/unmapped. */
export type SiteCountryCode = string;
/** Provider-neutral market for an observation. Never contains a vendor id. */
export type SiteMarket = {
    country: SiteCountryCode;
    region: string | null;
    city: string | null;
    language: string;
    device: 'desktop' | 'mobile' | 'all';
};
/** How the observation was obtained. */
export type SourceKind = 'first_party' | 'provider_observation' | 'estimate' | 'ai_interpretation';
/**
 * Explicit freshness class. `fresh` and `stale` are derived from
 * observedAt/freshUntil; the degraded states are stamped by the caller.
 */
export type Freshness = 'fresh' | 'stale' | 'partial' | 'blocked' | 'failed' | 'unknown';
/**
 * Closed application key for a coverage/status note. Callers pick a key from
 * the app-owned namespace; the client translates it. Raw vendor prose never
 * reaches this field.
 */
export type CoverageNoteKey = string;
/**
 * Additive provenance metadata attached to any observation-shaped payload.
 * Every field is present on the wire; nullable fields explicitly carry
 * `null` rather than being omitted so consumers can distinguish "not set"
 * from "unknown property".
 */
export type ObservationMeta = {
    sourceKind: SourceKind;
    sourceLabel: string | null;
    observedAt: string;
    freshUntil: string | null;
    freshness: Freshness;
    market: SiteMarket | null;
    sampleCount: number;
    coverageNoteKey: CoverageNoteKey | null;
};
/** Bounded input for {@link buildSiteMarket}. Bounds/validators live in the runtime. */
export type SiteMarketInput = {
    country: string;
    region?: string | null;
    city?: string | null;
    language: string;
    device?: 'desktop' | 'mobile' | 'all';
};
/** Input for {@link buildObservationMeta}. */
export type ObservationMetaInput = {
    sourceKind: SourceKind;
    sourceLabel?: string | null;
    observedAt: Date | string;
    freshUntil?: Date | string | null;
    market?: SiteMarket | null;
    sampleCount?: number;
    coverageNoteKey?: CoverageNoteKey | null;
    /** Explicit degraded status; overrides fresh/stale derivation. */
    status?: Extract<Freshness, 'partial' | 'blocked' | 'failed' | 'unknown'>;
    /** Reference `now` for freshness derivation. Injectable for tests. */
    now?: Date;
};
