/**
 * Review source setup: per-source format validation, honest readiness
 * (saved vs verified), confirmed removal with a toast.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ReviewSourcesPanel } from './components/ReviewSourcesPanel';
import { localSeoReviewsReducer } from './store/slice';
import { loadReviewRuns, loadReviewSources } from './store/thunks';
import { reviewRun, reviewSource } from './__fixtures__/reviews';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);
const GOOGLE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

interface Wire {
  sources?: ReturnType<typeof reviewSource>[];
  runs?: ReturnType<typeof reviewRun>[];
  onDelete?: () => unknown;
}

const posts: unknown[] = [];

const wire = ({ sources = [], runs = [], onDelete }: Wire = {}) => {
  mockedApiClient.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/local-seo/reviews/sources' && init?.method === 'POST') {
        posts.push(init.body);
        const body = init.body as { source: 'google'; target: string };
        return reviewSource({
          id: `new-${body.source}`,
          source: body.source,
          target: body.target,
        }) as never;
      }
      if (path.startsWith('/local-seo/reviews/sources/') && init?.method === 'DELETE') {
        if (onDelete) return onDelete() as never;
        return { id: path.split('/').pop(), deleted: true } as never;
      }
      if (path.startsWith('/local-seo/reviews/sources')) return { sources } as never;
      if (path.startsWith('/local-seo/reviews/runs')) return { runs, nextCursor: null } as never;
      throw new Error(`unexpected path ${path}`);
    },
  );
};

const renderPanel = async () => {
  const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
  await store.dispatch(loadReviewSources('site-1') as never);
  await store.dispatch(loadReviewRuns('site-1') as never);
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ReviewSourcesPanel profileId="site-1" />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  vi.mocked(toast.success).mockReset();
  posts.length = 0;
});

describe('source id validation', () => {
  it.each([
    ['google', 'abc', /valid Google Place ID/],
    ['google', 'Joes Coffee Downtown', /valid Google Place ID/],
    ['google', 'ChIJshort', /valid Google Place ID/],
    ['trustpilot', 'abc', /business domain Trustpilot lists/],
    ['trustpilot', 'https://example.com', /without https:\/\//],
    ['tripadvisor', 'g-99001', /numeric Tripadvisor location ID/],
    ['tripadvisor', 'abc', /numeric Tripadvisor location ID/],
  ] as const)('rejects %s "%s" inline without calling the API', async (source, value, message) => {
    wire();
    const user = userEvent.setup();
    await renderPanel();
    const input = screen.getByTestId(`reviews-source-input-${source}`);
    await user.type(input, value);
    await user.click(screen.getByTestId(`reviews-source-save-${source}`));
    const error = await screen.findByTestId(`reviews-source-error-${source}`);
    expect(error).toHaveTextContent(message);
    expect(error).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
    if (source === 'google') {
      // The hint stays first and the error comes after it.
      const hint = screen.getByTestId('reviews-source-help-google');
      expect(hint.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(input).toHaveAttribute('aria-describedby', `${hint.id} ${error.id}`);
    }
    expect(posts).toHaveLength(0);
    // Editing clears the error and keeps what was typed.
    await user.type(input, 'x');
    expect(screen.queryByTestId(`reviews-source-error-${source}`)).not.toBeInTheDocument();
  });

  it.each([
    ['google', GOOGLE_ID, GOOGLE_ID],
    ['trustpilot', 'WWW.Example.COM', 'example.com'],
    ['tripadvisor', 'd23462501', '23462501'],
  ] as const)('saves a valid %s id as the normalized "%s"', async (source, value, stored) => {
    wire();
    const user = userEvent.setup();
    await renderPanel();
    await user.type(screen.getByTestId(`reviews-source-input-${source}`), value);
    await user.click(screen.getByTestId(`reviews-source-save-${source}`));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ source, target: stored });
    await waitFor(() =>
      expect(screen.getByTestId(`reviews-source-configured-${source}`)).toBeVisible(),
    );
    expect(screen.queryByTestId(`reviews-source-error-${source}`)).not.toBeInTheDocument();
  });

  it('keeps the typed value when the server refuses the save', async () => {
    wire();
    mockedApiClient.mockImplementationOnce(async () => ({ sources: [] }) as never);
    const user = userEvent.setup();
    await renderPanel();
    mockedApiClient.mockRejectedValueOnce(new ApiError('bad', 400, { error: { message: 'No.' } }));
    const input = screen.getByTestId('reviews-source-input-google');
    await user.type(input, GOOGLE_ID);
    await user.click(screen.getByTestId('reviews-source-save-google'));
    expect(await screen.findByTestId('reviews-sources-mutation-error')).toBeVisible();
    expect(input).toHaveValue(GOOGLE_ID);
  });

  it('does nothing when Enter is pressed on a blank field', async () => {
    wire();
    const user = userEvent.setup();
    await renderPanel();
    await user.type(screen.getByTestId('reviews-source-input-google'), '   {Enter}');
    expect(posts).toHaveLength(0);
    expect(screen.queryByTestId('reviews-source-error-google')).not.toBeInTheDocument();
  });
});

describe('source readiness', () => {
  const chip = (source: string) => screen.getByTestId(`reviews-source-configured-${source}`);

  it('calls a freshly saved, never-synced source "Saved, not synced yet" (not verified)', async () => {
    wire({ sources: [reviewSource({ target: GOOGLE_ID })] });
    await renderPanel();
    expect(chip('google')).toHaveTextContent('Saved, not synced yet');
    expect(chip('google')).toHaveAttribute('data-status', 'saved');
    expect(chip('google')).not.toHaveTextContent(/set up|verified/i);
  });

  it('shows "Verified by sync" only after a sync got reviews back', async () => {
    wire({ sources: [reviewSource({ target: GOOGLE_ID })], runs: [reviewRun()] });
    await renderPanel();
    expect(chip('google')).toHaveTextContent('Verified by sync');
    expect(chip('google')).toHaveAttribute('data-status', 'verified');
  });

  it('shows a failed last sync and flags an old value that is not a valid id', async () => {
    wire({
      sources: [
        reviewSource({ target: GOOGLE_ID }),
        reviewSource({ id: 'src-tp', source: 'trustpilot', target: 'abc' }),
      ],
      runs: [
        reviewRun({
          perSourceOutcomes: [{ source: 'google', outcome: 'failed', retained: 0, errorCode: 'X' }],
        }),
      ],
    });
    await renderPanel();
    expect(chip('google')).toHaveTextContent('Last sync failed');
    expect(chip('trustpilot')).toHaveTextContent('Check this ID');
    expect(chip('trustpilot')).toHaveAttribute('data-status', 'invalid');
  });
});

describe('source removal', () => {
  it('asks first; cancelling keeps the source and shows no toast', async () => {
    wire({ sources: [reviewSource({ target: GOOGLE_ID })] });
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByTestId('reviews-source-remove-google'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Remove this source?');
    expect(dialog).toHaveTextContent('Google will no longer be included in new syncs');
    await user.click(within(dialog).getByRole('button', { name: 'Keep source' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('reviews-source-configured-google')).toBeVisible();
    expect(
      mockedApiClient.mock.calls.some(
        ([, init]) => (init as { method?: string })?.method === 'DELETE',
      ),
    ).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('closes on Escape without removing', async () => {
    wire({ sources: [reviewSource({ target: GOOGLE_ID })] });
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByTestId('reviews-source-remove-google'));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('reviews-source-configured-google')).toBeVisible();
  });

  it('removes on confirmation and announces it with a success toast', async () => {
    wire({ sources: [reviewSource({ target: GOOGLE_ID })] });
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByTestId('reviews-source-remove-google'));
    await user.click(await screen.findByTestId('reviews-source-remove-confirm'));
    await waitFor(() =>
      expect(screen.queryByTestId('reviews-source-configured-google')).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledWith('Google source removed.');
  });

  it('keeps the source and shows no success toast when the removal fails', async () => {
    wire({
      sources: [reviewSource({ target: GOOGLE_ID })],
      onDelete: () => {
        throw new ApiError('boom', 500, { error: { message: 'Nope.' } });
      },
    });
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByTestId('reviews-source-remove-google'));
    await user.click(await screen.findByTestId('reviews-source-remove-confirm'));
    expect(await screen.findByTestId('reviews-sources-mutation-error')).toBeVisible();
    expect(screen.getByTestId('reviews-source-configured-google')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
