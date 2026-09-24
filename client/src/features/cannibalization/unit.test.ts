/**
 * Unit-level cover for the cannibalization API wrappers, the slice reducers
 * that the page never reaches, and the route registration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  fetchCannibalizationReport,
  fetchCannibalizationReports,
  fetchCannibalizationPrerequisites,
  generateCannibalizationReport,
  previewCannibalizationReport,
} from './api';
import {
  cannibalizationReducer,
  clearCannibalizationPreview,
  resetCannibalization,
} from './store/slice';
import {
  generateCannibalizationReportThunk,
  loadCannibalizationReport,
  loadCannibalizationReports,
  loadCannibalizationPrerequisites,
  previewCannibalizationReportThunk,
} from './store/thunks';
import { initialCannibalizationState, type CannibalizationState } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  mockedApiClient.mockReset();
});

describe('api wrappers', () => {
  it.each([
    [
      {
        status: 'connected',
        propertyUrl: 'sc-domain:a.test',
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      },
      true,
    ],
    [{ status: 'connected', propertyUrl: 'sc-domain:a.test' }, true],
    [{ status: 'connected', propertyUrl: null, scopes: [] }, false],
    [{ status: 'connected', propertyUrl: 'sc-domain:a.test', scopes: [] }, false],
    [null, false],
  ] as const)('reads the real GSC prerequisite %#', async (connection, expected) => {
    mockedApiClient.mockResolvedValueOnce({
      configuration: {
        connection: connection
          ? {
              status: connection.status,
              ...('scopes' in connection ? { scopes: connection.scopes } : {}),
            }
          : null,
        gsc: {
          propertyUrl: connection?.propertyUrl ?? null,
        },
      },
    } as never);

    await expect(fetchCannibalizationPrerequisites('site-1')).resolves.toEqual({
      gscConnected: expected,
    });
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/configuration',
    );
  });

  it('posts the window on preview and generate', async () => {
    mockedApiClient.mockResolvedValue({} as never);
    await previewCannibalizationReport('site-1', 7);
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/sites/site-1/cannibalization-reports/preview',
      { method: 'POST', body: { windowDays: 7 } },
    );
    await generateCannibalizationReport('site-1', 90);
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/sites/site-1/cannibalization-reports',
      { method: 'POST', body: { windowDays: 90 } },
    );
  });

  it('adds the window query only when asked, and forwards the signal', async () => {
    const signal = new AbortController().signal;
    mockedApiClient.mockResolvedValue({ items: [] } as never);
    await fetchCannibalizationReports('site-1');
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/sites/site-1/cannibalization-reports',
      {},
    );
    await fetchCannibalizationReports('site-1', { windowDays: 28, signal });
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/sites/site-1/cannibalization-reports?windowDays=28',
      { signal },
    );
  });

  it('reads one stored report with and without a signal', async () => {
    const signal = new AbortController().signal;
    mockedApiClient.mockResolvedValue({} as never);
    await fetchCannibalizationReport('r1');
    expect(mockedApiClient).toHaveBeenCalledWith('/cannibalization-reports/r1', {});
    await fetchCannibalizationReport('r1', { signal });
    expect(mockedApiClient).toHaveBeenCalledWith('/cannibalization-reports/r1', {
      signal,
    });
  });
});

describe('slice reducers', () => {
  const reduce = (state: CannibalizationState, action: { type: string; payload?: unknown }) =>
    cannibalizationReducer(state, action as never);

  it('clears the preview and both action statuses', () => {
    const dirty: CannibalizationState = {
      ...initialCannibalizationState,
      preview: {},
      previewStatus: 'succeeded',
      previewGate: { kind: 'failed', message: 'x' },
      generateStatus: 'failed',
      generateGate: { kind: 'failed', message: 'y' },
    };
    const next = cannibalizationReducer(dirty, clearCannibalizationPreview());
    expect(next.preview).toBeNull();
    expect(next.previewStatus).toBe('idle');
    expect(next.previewGate).toBeNull();
    expect(next.generateStatus).toBe('idle');
    expect(next.generateGate).toBeNull();
  });

  it('resets to the initial state', () => {
    expect(
      cannibalizationReducer(
        { ...initialCannibalizationState, sitesStatus: 'failed' },
        resetCannibalization(),
      ),
    ).toEqual(initialCannibalizationState);
  });

  it('records a site-load failure and its empty-payload fallback', () => {
    const failed = reduce(initialCannibalizationState, {
      type: loadCannibalizationPrerequisites.rejected.type,
      payload: 'boom',
    });
    expect(failed.sitesStatus).toBe('failed');
    expect(failed.sitesError).toBe('boom');
    const noPayload = reduce(initialCannibalizationState, {
      type: loadCannibalizationPrerequisites.rejected.type,
    });
    expect(noPayload.sitesError).toBe('');
  });

  it('falls back to a null gate when a rejection carries no payload', () => {
    for (const thunk of [
      loadCannibalizationReports,
      loadCannibalizationReport,
      previewCannibalizationReportThunk,
      generateCannibalizationReportThunk,
    ]) {
      const next = reduce(initialCannibalizationState, { type: thunk.rejected.type });
      expect(next.listGate ?? next.detailGate ?? next.previewGate ?? next.generateGate).toBeNull();
    }
  });

  it('marks the prerequisite load as loading', () => {
    const next = reduce(
      { ...initialCannibalizationState, sitesError: 'stale' },
      { type: loadCannibalizationPrerequisites.pending.type },
    );
    expect(next.sitesStatus).toBe('loading');
    expect(next.sitesError).toBe('');
    expect(next.gscConnected).toBeNull();
  });

  it('stores the GSC prerequisite result', () => {
    const next = reduce(initialCannibalizationState, {
      type: loadCannibalizationPrerequisites.fulfilled.type,
      payload: { gscConnected: true },
    });
    expect(next.sitesStatus).toBe('succeeded');
    expect(next.gscConnected).toBe(true);
  });
});
