import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  __resetPresentationLocaleForTests,
  requestPresentationRefresh,
  setPresentationLocale,
} from '@shared/i18n/presentationLocale';
import { PresentationLocaleBoundary } from './PresentationLocaleBoundary';
import type { AppStore } from './store';

vi.mock('sonner', () => ({ toast: { dismiss: vi.fn() } }));

describe('PresentationLocaleBoundary', () => {
  beforeEach(() => {
    __resetPresentationLocaleForTests();
    vi.clearAllMocks();
    document.head.innerHTML = '<link rel="manifest" href="/site.en.webmanifest">';
  });

  it('dispatches the central invalidation and clears transient toasts on change', async () => {
    const dispatch = vi.fn();
    render(
      <PresentationLocaleBoundary
        store={{ dispatch } as unknown as AppStore}
      />,
    );

    setPresentationLocale('ar');

    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'i18n/presentationLocaleChanged',
      payload: { locale: 'ar', generation: 1, reason: 'language-changed' },
    });
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/site.ar.webmanifest',
    );
  });

  it('dispatches a free-read refresh without changing the active locale', async () => {
    const dispatch = vi.fn();
    render(
      <PresentationLocaleBoundary
        store={{ dispatch } as unknown as AppStore}
      />,
    );

    requestPresentationRefresh();

    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: { locale: 'en', generation: 0, reason: 'stale-mutation' },
    });
  });
});
