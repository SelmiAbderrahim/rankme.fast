import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@shared/api/client';
import { i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { KeywordMarketMove } from './KeywordMarketMove';
import type { KeywordMarketMovePreview } from '../types';

vi.mock('../api', () => ({
  fetchKeywordMarketMoveRequest: vi.fn(),
  moveKeywordsToSiteMarketRequest: vi.fn(),
}));

const mocked = vi.mocked(api);
const preview: KeywordMarketMovePreview = {
  target: { locationCode: 2840, languageCode: 'en', device: 'desktop' },
  tracked: 5, inTarget: 2, movable: 3, alreadyTracked: 1,
  withHistory: 2, resumesHistory: 1, token: 'token-1',
};
const renderMove = (siteId = 'site-1', onMoved = vi.fn()) => render(
  <I18nextProvider i18n={i18n}>
    <KeywordMarketMove siteId={siteId} keywordCount={5} onMoved={onMoved} />
  </I18nextProvider>,
);

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  window.localStorage.clear();
  vi.clearAllMocks();
  mocked.fetchKeywordMarketMoveRequest.mockResolvedValue({ preview });
  mocked.moveKeywordsToSiteMarketRequest.mockResolvedValue({ moved: 3, preview: { ...preview, movable: 0 } });
});

describe('KeywordMarketMove', () => {
  it('previews a move and changes keywords only after confirmation', async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    renderMove('site-1', onMoved);
    await screen.findByTestId('keyword-market-move');
    expect(mocked.moveKeywordsToSiteMarketRequest).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('keyword-market-move-review'));
    expect(screen.getByTestId('keyword-market-move-count')).toHaveTextContent('3');
    await user.click(screen.getByTestId('keyword-market-move-confirm'));
    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce());
    expect(mocked.moveKeywordsToSiteMarketRequest).toHaveBeenCalledWith('site-1', 'token-1');
    expect(screen.getByTestId('keyword-market-move-done')).toHaveTextContent('Moved 3 keywords');
  });

  it('requires a fresh review when the preview token becomes stale', async () => {
    const user = userEvent.setup();
    mocked.moveKeywordsToSiteMarketRequest.mockRejectedValueOnce(new ApiError('changed', 409, {}));
    mocked.fetchKeywordMarketMoveRequest.mockResolvedValueOnce({ preview }).mockResolvedValueOnce({ preview: { ...preview, token: 'token-2', movable: 2 } });
    renderMove();
    await screen.findByTestId('keyword-market-move');
    await user.click(screen.getByTestId('keyword-market-move-review'));
    await user.click(screen.getByTestId('keyword-market-move-confirm'));
    await waitFor(() => expect(mocked.fetchKeywordMarketMoveRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/keyword list changed/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('keyword-market-move-review'));
    await user.click(screen.getByTestId('keyword-market-move-confirm'));
    await waitFor(() => expect(mocked.moveKeywordsToSiteMarketRequest).toHaveBeenLastCalledWith('site-1', 'token-2'));
  });

  it('dismisses a site and target without dismissing another site', async () => {
    const user = userEvent.setup();
    const first = renderMove();
    await screen.findByTestId('keyword-market-move');
    await user.click(screen.getByTestId('keyword-market-move-dismiss'));
    expect(screen.queryByTestId('keyword-market-move')).not.toBeInTheDocument();
    first.unmount();
    renderMove('site-2');
    expect(await screen.findByTestId('keyword-market-move')).toBeInTheDocument();
  });

  it('does not apply a move response to a different site after navigation', async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    let resolveMove: ((value: { moved: number; preview: KeywordMarketMovePreview }) => void) | undefined;
    mocked.moveKeywordsToSiteMarketRequest.mockReturnValueOnce(new Promise((resolve) => { resolveMove = resolve; }));
    const view = renderMove('site-1', onMoved);
    await screen.findByTestId('keyword-market-move');
    await user.click(screen.getByTestId('keyword-market-move-review'));
    await user.click(screen.getByTestId('keyword-market-move-confirm'));
    view.rerender(<I18nextProvider i18n={i18n}>
      <KeywordMarketMove siteId="site-2" keywordCount={5} onMoved={onMoved} />
    </I18nextProvider>);
    resolveMove?.({ moved: 3, preview: { ...preview, movable: 0 } });
    await waitFor(() => expect(mocked.fetchKeywordMarketMoveRequest).toHaveBeenLastCalledWith('site-2', expect.any(AbortSignal)));
    expect(onMoved).not.toHaveBeenCalled();
    expect(screen.queryByTestId('keyword-market-move-done')).not.toBeInTheDocument();
  });
});
