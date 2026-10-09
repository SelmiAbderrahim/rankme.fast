import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  readAnalyticsChoice,
  resetAnalyticsChoiceMemory,
  writeAnalyticsChoice,
} from '@shared/analytics/consent';
import { AnalyticsPreference } from './AnalyticsPreference';

const renderCard = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <AnalyticsPreference />
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

describe('AnalyticsPreference', () => {
  it('renders nothing when analytics is not configured', () => {
    vi.stubEnv('VITE_GA_ID', '');
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('is off until the user opts in, and lets them grant and withdraw', async () => {
    renderCard();
    const toggle = screen.getByRole('switch', { name: 'Allow usage analytics' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(readAnalyticsChoice()).toBe('granted');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(readAnalyticsChoice()).toBe('denied');
    expect(toggle).not.toBeChecked();
  });

  it('reflects an existing grant', () => {
    writeAnalyticsChoice('granted');
    renderCard();
    expect(screen.getByRole('switch', { name: 'Allow usage analytics' })).toBeChecked();
  });
});
