import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  readAnalyticsChoice,
  resetAnalyticsChoiceMemory,
  writeAnalyticsChoice,
} from '@shared/analytics/consent';
import { AnalyticsConsentBanner } from './AnalyticsConsentBanner';

const renderBanner = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <main>
        <AnalyticsConsentBanner />
      </main>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.stubEnv('VITE_GA_ID', 'G-TEST123');
  window.localStorage.clear();
  resetAnalyticsChoiceMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AnalyticsConsentBanner', () => {
  it('renders nothing when the build has no measurement id', () => {
    vi.stubEnv('VITE_GA_ID', '');
    renderBanner();
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
  });

  it('renders nothing on the server so hydration matches', () => {
    const html = renderToString(
      <I18nextProvider i18n={i18n}>
        <AnalyticsConsentBanner />
      </I18nextProvider>,
    );
    expect(html).toBe('');
  });

  it('asks first, with equally available accept and decline controls', () => {
    renderBanner();
    expect(screen.getByRole('region', { name: 'Analytics consent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept analytics' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeEnabled();
    expect(readAnalyticsChoice()).toBeNull();
  });

  it('stores a grant, hides, and moves focus to the main landmark', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Accept analytics' }));
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('stores a decline and hides', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('denied');
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
  });

  it('stays hidden when a choice already exists, and reappears when it is cleared', async () => {
    writeAnalyticsChoice('denied');
    renderBanner();
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
    await userEvent.click(document.body);
    writeAnalyticsChoice(null);
    expect(await screen.findByTestId('analytics-consent-banner')).toBeInTheDocument();
  });

  it('reuses the main landmark focus target when asked again', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    writeAnalyticsChoice(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept analytics' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });

  it('copes with a page that has no main landmark', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AnalyticsConsentBanner />
      </I18nextProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
  });
});
