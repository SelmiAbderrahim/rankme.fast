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
  /** Checked in the window and never mentioned. */
  notMentionedPrompts: string[];
  /** Tracked prompts with no completed check yet; absent on older servers. */
  notCheckedPrompts?: string[];
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
  /** Language the prompt is written in (a site can have two); absent on older rows. */
  language?: SupportedLocale;
}

/** How much stored evidence about the site a suggestion run was built from. */
export type AiVisibilitySuggestionsEvidence = 'rich' | 'limited' | 'none';

export interface AiVisibilityStoredSuggestions {
  /** null = never generated; non-null with an empty list = generated, empty. */
  generatedAt: string | null;
  outputLocale: SupportedLocale;
  suggestions: AiVisibilitySuggestion[];
  /**
   * `limited` / `none` = built from thin evidence (the panel says so); null or
   * absent = unknown (a run stored before the server tracked it, or no run).
   */
  evidence?: AiVisibilitySuggestionsEvidence | null;
  /**
   * The newest stored set was built before suggestions used only this site's
   * data, so the server withheld it; the panel offers to regenerate. Optional
   * so older responses parse.
   */
  stale?: boolean;
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
  /** Evidence level of the loaded set; null = unknown or never generated. */
  suggestionsEvidence: AiVisibilitySuggestionsEvidence | null;
  /** Frozen locale of the loaded/generated artifact, never the market language. */
  suggestionsOutputLocale: SupportedLocale | null;
  /** The stored set was withheld as stale (see `AiVisibilityStoredSuggestions.stale`). */
  suggestionsStale: boolean;
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
