import type { SupportedLocale } from '@shared/i18n';

export type AiSentiment = 'positive' | 'neutral' | 'negative';

export interface AiTrackedPrompt {
  id: string;
  prompt: string;
  createdAt: string;
}

export interface AiVisibilitySnapshot {
  prompt: string;
  model: string;
  mentioned: boolean;
  citedUrl: string | null;
  sentiment: AiSentiment | null;
  checkedAt: string;
}

export interface AiVisibilityOverview {
  prompts: AiTrackedPrompt[];
  snapshots: AiVisibilitySnapshot[];
  shareOfVoicePct: number | null;
  sentiment: { positive: number; neutral: number; negative: number };
  notMentionedPrompts: string[];
  checkedAt: string | null;
}

export type AiVisibilitySuggestionSource = 'template' | 'ai';

export interface AiVisibilitySuggestion {
  prompt: string;
  /** Optional so cached pre-`source` API responses still parse. */
  source?: AiVisibilitySuggestionSource;
  /** Taxonomy; may be null on older stored rows, absent on pre-taxonomy responses. */
  funnelStage?: 'awareness' | 'consideration' | 'decision' | 'postPurchase' | null;
  promptType?:
    | 'categoryDiscovery'
    | 'comparison'
    | 'alternatives'
    | 'problemFirst'
    | 'useCase'
    | 'pricingCommercial'
    | 'brandAccuracy'
    | 'objection'
    | null;
  intent?: 'informational' | 'commercial' | 'transactional' | 'navigational' | null;
  branded?: boolean | null;
  evidenceSource?: 'gsc' | 'keyword' | 'title' | 'competitor' | 'llmSynthesis' | null;
  evidenceRef?: string | null;
}

export interface AiVisibilityStoredSuggestions {
  /** null = never generated; non-null with an empty list = generated, empty. */
  generatedAt: string | null;
  outputLocale: SupportedLocale;
  suggestions: AiVisibilitySuggestion[];
}

export interface AiVisibilityTrendPoint {
  day: string;
  mentionedRatePct: number | null;
  shareOfVoicePct: number | null;
  checks: number;
}

export interface AiVisibilityState {
  siteId: string | null;
  overview: AiVisibilityOverview | null;
  suggestions: AiVisibilitySuggestion[];
  trend: AiVisibilityTrendPoint[];
  loading: boolean;
  loaded: boolean;
  suggestionsLoading: boolean;
  trendLoading: boolean;
  error: string;
  suggestionsError: string;
  trendError: string;
  /**
   * ISO timestamp of the newest stored generation; null = never generated.
   * Drives the never-generated vs generated-empty split in the panel.
   */
  suggestionsGeneratedAt: string | null;
  /** Frozen locale of the loaded/generated artifact, never the market language. */
  suggestionsOutputLocale: SupportedLocale | null;
  suggestionsGenerating: boolean;
  /**
   * Suggestion-specific cooldown. Deliberately NOT the shared `cooldownUntil`
   * field: that is read by the mention-check RefreshButton, so writing
   * suggestion failures into it cross-disabled an unrelated button.
   */
  suggestionsCooldownUntil: number | null;
  isRefreshing: boolean;
  cooldownUntil: number | null;
  refreshError: string;
  adding: boolean;
  addingAll: boolean;
  removingId: string | null;
}
