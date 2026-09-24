import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import { ApiError } from '@shared/api/client';
import type { CodeFixPromptInput } from '@shared/components/CodeFixPromptButton';
import type { ContentAnalysis, RecommendationOutcome } from '../types';

const api = vi.hoisted(() => ({
  mutateRecommendation: vi.fn(),
  getRecommendationApplicationCheck: vi.fn(),
  listRecommendationHistory: vi.fn(),
  getRecommendationOutcome: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock('../api', () => api);
vi.mock('sonner', () => ({ toast }));
vi.mock('@features/report-export', () => ({
  ReportExportControl: () => <div data-testid="report-export-control" />,
}));
vi.mock('@shared/components/CodeFixPromptButton', () => ({
  CodeFixPromptButton: ({ input }: { input: CodeFixPromptInput }) => (
    <button type="button" data-testid="code-fix-prompt" data-input={JSON.stringify(input)}>
      Copy code prompt
    </button>
  ),
}));

import { RecommendationWorkflow } from './RecommendationWorkflow';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { contentIntelligence: en } } });

function state(recommendationId: string, value: 'accepted' | 'dismissed' | 'applied', version: number) {
  return {
    recommendationId,
    analysisVersion: '2026-07-15.1',
    state: value,
    version,
    actorUserId: 'actor',
    stateChangedAt: '2026-06-15T00:00:00Z',
    appliedAt: value === 'applied' ? '2026-06-15T00:00:00Z' : null,
    baselineAnchorAt: value === 'applied' ? '2026-06-15T00:00:00Z' : null,
    contentHash: value === 'applied' ? 'new' : null,
    analysisContentHash: value === 'applied' ? 'old' : null,
    hashStatus: value === 'applied' ? 'changed' as const : 'unavailable' as const,
  };
}

const analysis: ContentAnalysis = {
  analysisId: 'analysis-1',
  siteId: 'site-1',
  ownedUrl: 'https://example.com/guide',
  keyword: 'content audit',
  locale: 'en',
  status: 'completed',
  stages: [],
  warnings: [],
  scorecard: null,
  schemaVersion: '2026-07-15.1',
  scorecardV2: null,
  owned: { url: 'https://example.com/guide', contentHash: 'old' },
  recommendations: [
    { id: 'r1', section: 'coverage', ruleId: 'a', direction: 'add', confidence: 0.9, messageKey: 'x', message: 'Add useful coverage.', evidenceSourceIds: ['owned'] },
    { id: 'r2', section: 'structure', ruleId: 'b', direction: 'clarify', confidence: 0.6, messageKey: 'y', message: 'Clarify the structure.', evidenceSourceIds: [] },
    { id: 'r3', section: 'links', ruleId: 'c', direction: 'remove', confidence: 0.2, messageKey: 'z', message: 'Remove the weak link.', evidenceSourceIds: [] },
    { id: 'r4', section: 'schema', ruleId: 'd', direction: 'strengthen', confidence: 0.4, messageKey: 'q', message: 'Strengthen the schema.', evidenceSourceIds: [] },
  ],
  recommendationStates: [state('r2', 'accepted', 1), state('r3', 'dismissed', 1), state('r4', 'applied', 2)],
  brief: null,
  draft: null,
  citations: [],
  error: null,
  reservation: { key: 'k', reservedUnits: 1, refundedAt: null, refundReason: null },
  costMicros: 0,
  aiCostMicros: 0,
  requestedAt: null,
  startedAt: null,
  completedAt: '2026-06-15T00:00:00Z',
  cancelledAt: null,
};

const fullOutcome: RecommendationOutcome = {
  available: true,
  dataAvailable: true,
  appliedAt: '2026-06-15T00:00:00Z',
  contentHash: 'new',
  hashStatus: 'changed',
  window: {
    baselineStart: '2026-05-18T00:00:00Z',
    baselineEnd: '2026-06-15T00:00:00Z',
    followingStart: '2026-06-15T00:00:00Z',
    followingEnd: '2026-07-13T00:00:00Z',
    complete: false,
  },
  coverage: {
    gsc: { baselineDays: 2, followingDays: 1, expectedDays: 28, completeness: 'partial', confidence: 'low' },
    rank: { baselineDays: 2, followingDays: 2, expectedDays: 28, completeness: 'partial', confidence: 'low' },
  },
  metrics: {
    clicks: { baseline: 1, following: 2, delta: { absolute: 1, relative: 1 } },
    impressions: { baseline: null, following: null, delta: { absolute: null, relative: null } },
    ctr: { baseline: 0.1, following: 0.2, delta: { absolute: 0.1, relative: 1 } },
    averagePosition: { baseline: 8, following: 6, delta: { absolute: -2, relative: -0.25 } },
    rankPosition: { baseline: 9, following: 7, delta: { absolute: -2, relative: -0.22 } },
  },
  laterEdit: true,
  series: [
    { source: 'gsc', phase: 'baseline', observedAt: '2026-06-14T00:00:00Z', clicks: 1, impressions: 10, ctr: 0.1, averagePosition: 8, rankPosition: null, laterEdit: false },
    { source: 'gsc', phase: 'following', observedAt: '2026-06-16T00:00:00Z', clicks: 2, impressions: 12, ctr: 0.17, averagePosition: 6, rankPosition: null, laterEdit: true },
    { source: 'rank', phase: 'baseline', observedAt: '2026-06-14T00:00:00Z', clicks: null, impressions: null, ctr: null, averagePosition: null, rankPosition: 9, laterEdit: false },
    { source: 'rank', phase: 'following', observedAt: '2026-06-16T00:00:00Z', clicks: null, impressions: null, ctr: null, averagePosition: null, rankPosition: 7, laterEdit: true },
  ],
};

function renderWorkflow(
  initialEntry = '/sites/site-1?analysis=analysis-1',
  onChanged = vi.fn(),
  analysisInput: ContentAnalysis = analysis,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RecommendationWorkflow analysis={analysisInput} onChanged={onChanged} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  api.mutateRecommendation.mockReset().mockResolvedValue({ state: state('r1', 'accepted', 1) });
  api.getRecommendationApplicationCheck.mockReset().mockResolvedValue({
    available: true,
    hashStatus: 'same',
    contentHash: 'old',
    analysisContentHash: 'old',
    noteRequired: true,
    freshnessDays: 30,
  });
  api.listRecommendationHistory.mockReset().mockResolvedValue({ events: [] });
  api.getRecommendationOutcome.mockReset().mockResolvedValue({ available: false });
  toast.success.mockReset();
});

describe('RecommendationWorkflow', () => {
  it('maps only eligible technical recommendations into code prompts', () => {
    renderWorkflow(
      '/sites/site-1?analysis=analysis-1',
      vi.fn(),
      {
        ...analysis,
        recommendations: [
          { ...analysis.recommendations[0]!, ruleId: 'add-title', codeFixPromptAvailable: true },
          analysis.recommendations[1]!,
        ],
        recommendationStates: [state('r1', 'dismissed', 2)],
      },
    );
    const button = screen.getByTestId('code-fix-prompt');
    expect(JSON.parse(button.dataset.input ?? '')).toEqual({
      reference: 'add-title',
      severity: 'high',
      confidence: '90%',
      problem: 'add to · Coverage',
      whyItMatters: 'Add useful coverage.',
      recommendedFix: 'Add useful coverage.',
      affectedUrls: ['https://example.com/guide'],
      affectedUrlCount: 1,
    });
    expect(screen.getAllByText('Copy code prompt')).toHaveLength(1);
  });

  it('shows every allowed action and submits a bounded note', async () => {
    const user = userEvent.setup();
    const onChanged = renderWorkflow();
    expect(screen.getAllByText('Accept')).toHaveLength(2);
    expect(screen.getAllByText('Dismiss')).toHaveLength(2);
    expect(screen.getByText('Mark applied')).toBeInTheDocument();
    expect(screen.getByText('Undo application')).toBeInTheDocument();

    await user.click(screen.getAllByText('Accept')[0]!);
    expect(screen.getByRole('dialog')).toHaveTextContent('Accept this recommendation?');
    await user.type(screen.getByLabelText('Note'), 'Reviewed');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.mutateRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      analysisId: 'analysis-1',
      recommendationId: 'r1',
      expectedVersion: 0,
      note: 'Reviewed',
    })));
    expect(toast.success).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it('renders safe, unsafe, and missing recommendation evidence without activating hostile URLs', () => {
    renderWorkflow(
      '/sites/site-1?analysis=analysis-1',
      vi.fn(),
      {
        ...analysis,
        recommendations: [{
          ...analysis.recommendations[0]!,
          evidenceSourceIds: ['safe', 'unsafe', 'missing'],
        }],
        recommendationStates: [],
        citations: [
          { sourceId: 'safe', url: 'https://source.example/evidence', title: null },
          { sourceId: 'unsafe', url: 'javascript:alert(1)', title: 'Unsafe evidence' },
        ],
      },
    );
    expect(screen.getByRole('link', { name: 'https://source.example/evidence' }))
      .toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Unsafe evidence' })).toBeNull();
    expect(screen.getByText('Unsafe evidence')).toBeInTheDocument();
    expect(screen.getByText('Owned-page evidence')).toBeInTheDocument();
  });

  it('surfaces conflicts inline and closes dialogs through their open state', async () => {
    const user = userEvent.setup();
    api.mutateRecommendation.mockRejectedValueOnce(new ApiError('conflict', 409, null));
    api.getRecommendationApplicationCheck.mockResolvedValueOnce({
      available: true,
      hashStatus: 'changed',
      contentHash: 'new',
      analysisContentHash: 'old',
      noteRequired: false,
      freshnessDays: 30,
    });
    renderWorkflow();
    await user.click(screen.getByText('Mark applied'));
    expect(await screen.findByText('Content change detected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm application' }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  });

  it('loads ordered history and renders neutral complete outcome details', async () => {
    const user = userEvent.setup();
    api.listRecommendationHistory.mockResolvedValueOnce({
      events: [{
        id: 'e1', eventKind: 'applied', priorState: 'accepted', newState: 'applied',
        stateVersion: 2, actorUserId: 'actor-1', note: 'Published manually',
        contentHash: 'new', analysisContentHash: 'old', hashStatus: 'changed',
        appliedAt: '2026-06-15T00:00:00Z', recordedAt: '2026-06-15T00:00:00Z',
      }],
    });
    api.getRecommendationOutcome.mockResolvedValueOnce(fullOutcome);
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findByText('Published manually')).toBeInTheDocument();
    expect(screen.getByText(/correlated movement, not attribution/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Available tracked rank observations/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Available Search Console click observations/ })).toBeInTheDocument();
    expect(screen.getByText(/still incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/later content edit/)).toBeInTheDocument();
    expect(screen.getByText('Applied content-hash anchor')).toBeInTheDocument();
    expect(screen.getByText('new')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('Relative change')).toBeInTheDocument();
    expect(screen.getByText(/^Previous 28 days: May 18, 2026 – Jun 14, 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^Following 28 days: Jun 15, 2026 – Jul 12, 2026$/)).toBeInTheDocument();
    expect(screen.getAllByText(/Recommendation confidence: Low/)).toHaveLength(2);
    expect(screen.getByText('Search Console observations')).toBeInTheDocument();
    expect(screen.getByText('Tracked rank observations')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Impressions' }).closest('tr')).toHaveTextContent('—');
  });

  it('shows unavailable outcome guidance, empty history, loading, and generic errors', async () => {
    const user = userEvent.setup();
    api.listRecommendationHistory.mockImplementationOnce(async () => {
      await Promise.resolve();
      return { events: [] };
    });
    api.getRecommendationOutcome.mockResolvedValueOnce({ available: false });
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findByText('No state changes yet.')).toBeInTheDocument();
    expect(screen.getByText('Outcome data is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open search data settings' }))
      .toHaveAttribute('href', '/sites/site-1?tab=google');

    api.listRecommendationHistory.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getAllByText('History and outcomes')[1]!);
    expect(await screen.findByText('The recommendation could not be updated.')).toBeInTheDocument();
  });

  it('preserves the applied anchor while missing synced sources remain unavailable', async () => {
    const user = userEvent.setup();
    api.getRecommendationOutcome.mockResolvedValueOnce({
      ...fullOutcome,
      dataAvailable: false,
      contentHash: 'applied-anchor',
      coverage: {
        gsc: { baselineDays: 0, followingDays: 0, expectedDays: 28, completeness: 'unavailable', confidence: 'low' },
        rank: { baselineDays: 0, followingDays: 0, expectedDays: 28, completeness: 'unavailable', confidence: 'low' },
      },
      series: [],
    });
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findByText('applied-anchor')).toBeInTheDocument();
    expect(screen.getByText('Outcome data is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open search data settings' }))
      .toHaveAttribute('href', '/sites/site-1?tab=google');
  });

  it('honors URL-backed state and severity filters', () => {
    renderWorkflow('/sites/site-1?analysis=analysis-1&recState=applied&severity=low');
    expect(screen.getByText('strengthen · Structured data and answer clarity')).toBeInTheDocument();
    expect(screen.queryByText('add to · Coverage')).not.toBeInTheDocument();
  });

  it('falls back safely for invalid URL filters', () => {
    renderWorkflow('/sites/site-1?analysis=analysis-1&recState=%24ne&severity=urgent');
    expect(screen.getByText('add to · Coverage')).toBeInTheDocument();
    expect(screen.getByText('strengthen · Structured data and answer clarity')).toBeInTheDocument();
  });

  it('uses the shared empty state when no recommendation matches both filters', () => {
    renderWorkflow('/sites/site-1?analysis=analysis-1&recState=applied&severity=high');
    expect(screen.getByText('No recommendations match these filters.')).toBeInTheDocument();
  });

  it('requires an explanatory note when the authorized hash is unchanged', async () => {
    const user = userEvent.setup();
    renderWorkflow();
    await user.click(screen.getByText('Mark applied'));
    expect(await screen.findByText('No content change detected')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm application' });
    expect(confirm).toBeDisabled();
    expect(screen.getAllByText(/explanatory note/)).toHaveLength(2);
    await user.type(screen.getByLabelText('Note'), 'Published through the CMS.');
    expect(confirm).toBeEnabled();
  });

  it('blocks apply when a recent authorized hash is unavailable', async () => {
    const user = userEvent.setup();
    api.getRecommendationApplicationCheck.mockResolvedValueOnce({
      available: false,
      hashStatus: 'unavailable',
      contentHash: null,
      analysisContentHash: null,
      noteRequired: false,
      freshnessDays: 30,
    });
    renderWorkflow();
    await user.click(screen.getByText('Mark applied'));
    expect(await screen.findByText('A recent page hash is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm application' })).toBeDisabled();
  });

  it('updates both URL-backed filters and runs dismiss and undo actions', async () => {
    const user = userEvent.setup();
    renderWorkflow();
    const filters = screen.getAllByRole('combobox');
    await user.click(filters[0]!);
    await user.click(screen.getByRole('option', { name: 'Accepted' }));
    expect(screen.getByText('clarify · Structure')).toBeInTheDocument();
    await user.click(filters[0]!);
    await user.click(screen.getByRole('option', { name: 'All states' }));
    await user.click(filters[1]!);
    await user.click(screen.getByRole('option', { name: 'High' }));
    expect(screen.getByText('add to · Coverage')).toBeInTheDocument();
    await user.click(filters[1]!);
    await user.click(screen.getByRole('option', { name: 'All severities' }));

    await user.click(screen.getAllByText('Dismiss')[0]!);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(api.mutateRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dismiss' }),
    ));
    await user.click(screen.getByText('Undo application'));
    await user.click(screen.getByRole('button', { name: 'Undo application' }));
    await waitFor(() => expect(api.mutateRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'undo' }),
    ));
  });

  it('shows a failed application check without issuing a mutation', async () => {
    const user = userEvent.setup();
    api.getRecommendationApplicationCheck.mockRejectedValueOnce(new Error('offline'));
    renderWorkflow();
    await user.click(screen.getByText('Mark applied'));
    expect(await screen.findByText('The page hash check could not be completed. Try again before confirming.')).toBeInTheDocument();
    expect(api.mutateRecommendation).not.toHaveBeenCalled();
  });

  it('renders complete sparse outcome data and an event without a note', async () => {
    const user = userEvent.setup();
    const sparseOutcome: RecommendationOutcome = {
      ...fullOutcome,
      dataAvailable: true,
      appliedAt: undefined,
      contentHash: null,
      hashStatus: undefined,
      window: { ...fullOutcome.window!, complete: true },
      coverage: {
        gsc: { baselineDays: 28, followingDays: 28, expectedDays: 28, completeness: 'complete', confidence: 'high' },
        rank: { baselineDays: 28, followingDays: 28, expectedDays: 28, completeness: 'complete', confidence: 'high' },
      },
      laterEdit: false,
      series: [
        { source: 'gsc', phase: 'following', observedAt: '2026-06-16T00:00:00Z', clicks: 1, impressions: null, ctr: null, averagePosition: null, rankPosition: null, laterEdit: false },
        { source: 'gsc', phase: 'following', observedAt: '2026-06-17T00:00:00Z', clicks: null, impressions: null, ctr: null, averagePosition: null, rankPosition: null, laterEdit: false },
        { source: 'rank', phase: 'following', observedAt: '2026-06-16T00:00:00Z', clicks: null, impressions: null, ctr: null, averagePosition: null, rankPosition: null, laterEdit: false },
      ],
    };
    api.listRecommendationHistory.mockResolvedValueOnce({
      events: [{
        id: 'e2', eventKind: 'accepted', priorState: 'suggested', newState: 'accepted',
        stateVersion: 1, actorUserId: 'actor-2', note: null,
        contentHash: null, analysisContentHash: null, hashStatus: 'unavailable',
        appliedAt: null, recordedAt: '2026-06-15T00:00:00Z',
      }],
    });
    api.getRecommendationOutcome.mockResolvedValueOnce(sparseOutcome);
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findAllByText('Accepted')).toHaveLength(2);
    expect(screen.queryByText(/still incomplete/)).toBeNull();
    expect(screen.queryByText(/later content edit/)).toBeNull();
    expect(screen.getByRole('img', { name: /Search Console click observations/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /tracked rank observations/i })).toBeNull();
  });

  it('handles an omitted series and refuses to close while a mutation is pending', async () => {
    const user = userEvent.setup();
    api.getRecommendationOutcome.mockResolvedValueOnce({ ...fullOutcome, series: undefined });
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findByText(/correlated movement, not attribution/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();

    let finishMutation: (() => void) | undefined;
    api.mutateRecommendation.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishMutation = resolve;
    }));
    await user.click(screen.getAllByText('Accept')[0]!);
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finishMutation?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps history visible when an outcome response has no view payload', async () => {
    const user = userEvent.setup();
    api.getRecommendationOutcome.mockResolvedValueOnce(null);
    renderWorkflow();
    await user.click(screen.getAllByText('History and outcomes')[0]!);
    expect(await screen.findByText('No state changes yet.')).toBeInTheDocument();
    expect(screen.queryByText(/correlated movement, not attribution/)).toBeNull();
  });
});
