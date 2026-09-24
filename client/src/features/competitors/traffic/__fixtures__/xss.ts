import type { TrafficSnapshotDetail } from '../types';

export const MALICIOUS_DOMAIN = '<img src=x onerror=alert(1)>.example';
export const MALICIOUS_COUNTRY_LABEL = '<script>window.__trafficXss = true</script>';

export const estimateObservation = {
  sourceKind: 'estimate',
  sourceLabel: 'dataforseo',
  observedAt: '2026-07-22T12:00:00.000Z',
  freshUntil: '2026-07-23T12:00:00.000Z',
  freshness: 'fresh',
  market: null,
  sampleCount: 1,
  coverageNoteKey: 'observations.coverage.estimateOnly',
} as const;

export const maliciousTrafficDetail: TrafficSnapshotDetail = {
  id: '0123456789abcdef01234567',
  siteId: null,
  targetDomain: MALICIOUS_DOMAIN,
  inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 },
  status: 'succeeded',
  retainedOps: { traffic: true, rankOverview: true, history: true },
  refunded: false,
  createdAt: '2026-07-22T12:00:00.000Z',
  completedAt: '2026-07-22T12:01:00.000Z',
  snapshot: {
    capturedAt: '2026-07-22T12:01:00.000Z',
    payload: {
      monthlyOrganicVisits: { value: 1200, observation: estimateObservation },
      topCountries: [
        { countryCode: 'US', visits: { value: 900, observation: estimateObservation } },
      ],
      domainRank: { value: 42, observation: estimateObservation },
      keywordCount: { value: 300, observation: estimateObservation },
      history: [
        {
          capturedAt: '2026-06-01T00:00:00.000Z',
          rank: { value: 45, observation: estimateObservation },
          traffic: { value: 1000, observation: estimateObservation },
          keywordCount: { value: 250, observation: estimateObservation },
        },
      ],
      retained: { traffic: true, rankOverview: true, history: true },
    },
  },
};
