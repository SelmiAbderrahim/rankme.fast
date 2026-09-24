import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { ReleaseStageBadge } from './ReleaseStageBadge';

describe('ReleaseStageBadge', () => {
  beforeEach(() => initI18n({ initialLocale: 'en' }));
  afterEach(() => vi.unstubAllEnvs());

  it('gives the compact beta badge a full accessible product-stage name', () => {
    vi.stubEnv('VITE_RELEASE_STAGE', 'beta');
    render(<I18nextProvider i18n={i18n}><ReleaseStageBadge /></I18nextProvider>);
    expect(screen.getByText('Beta')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/RankMeFast, public beta/i)).toHaveClass('sr-only');
  });

  it('removes the badge after general availability', () => {
    vi.stubEnv('VITE_RELEASE_STAGE', 'ga');
    render(<I18nextProvider i18n={i18n}><ReleaseStageBadge /></I18nextProvider>);
    expect(screen.queryByTestId('release-stage-badge')).not.toBeInTheDocument();
  });
});
