/**
 * Client mirror of the shared observation contracts.
 *
 * The wire shape is identical to the server. The client parses
 * ObservationMeta at the API trust boundary and renders source/market/
 * freshness with the shared disclosure component.
 */

export type SiteCountryCode = string;

export type SiteMarket = {
  country: SiteCountryCode;
  region: string | null;
  city: string | null;
  language: string;
  device: 'desktop' | 'mobile' | 'all';
};

export type SourceKind =
  | 'first_party'
  | 'provider_observation'
  | 'estimate'
  | 'ai_interpretation';

export type Freshness =
  | 'fresh'
  | 'stale'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'unknown';

export type CoverageNoteKey = string;

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
