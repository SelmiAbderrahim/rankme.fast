import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { TwoFactorRecommendation } from './TwoFactorRecommendation';
import { resetTwoFactorRecommendation } from '../useTwoFactorRecommendation';
import { fetchTwoFactorRecommendation, dismissTwoFactorRecommendation } from '../api';

vi.mock('../api', () => ({
  fetchTwoFactorRecommendation: vi.fn(),
  dismissTwoFactorRecommendation: vi.fn(),
}));
vi.mock('../useAuthSession', () => ({
  useAuthSession: () => ({
    authenticated: true, emailVerified: true, mustChangePassword: false,
    user: { id: 'owner', twoFactorEnabled: false },
  }),
}));
vi.mock('@shared/hooks/redux', () => ({ useAppSelector: () => 'owner' }));
vi.mock('../authClient', () => ({ authClient: { twoFactor: { enable: vi.fn() } } }));

beforeEach(() => {
  vi.clearAllMocks();
  resetTwoFactorRecommendation();
  initI18n({ initialLocale: 'en' });
  vi.mocked(fetchTwoFactorRecommendation).mockResolvedValue({ dismissedAt: null });
  vi.mocked(dismissTwoFactorRecommendation).mockResolvedValue({ dismissedAt: '2026-10-24T00:00:00Z' });
});

it('shows a dismissible owner recommendation after reading the saved preference', async () => {
  render(<I18nextProvider i18n={i18n}><MemoryRouter><TwoFactorRecommendation /></MemoryRouter></I18nextProvider>);
  expect(await screen.findByText('Turn on two-factor sign-in')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Set up two-factor' })).toHaveAttribute('href', '/settings/security');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss the two-factor recommendation' }));
  await waitFor(() => expect(dismissTwoFactorRecommendation).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Turn on two-factor sign-in')).not.toBeInTheDocument();
});
