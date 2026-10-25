import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { authClient } from '../authClient';
import { SetPassword } from './SetPassword';

vi.mock('../authClient', () => ({ authClient: { requestPasswordReset: vi.fn() } }));

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderCard = () => render(<I18nextProvider i18n={i18n}><SetPassword email="owner@example.test" /></I18nextProvider>);
const button = () => screen.getByRole('button', { name: i18n.t('setupPassword.title', { ns: 'auth' }) });

it('emails a single-use link and then disables the button', async () => {
  vi.mocked(authClient.requestPasswordReset).mockResolvedValue({ data: { status: true }, error: null } as never);
  renderCard();
  fireEvent.click(button());
  expect(await screen.findByText(i18n.t('setupPassword.sent', { ns: 'auth' }))).toBeInTheDocument();
  expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
    email: 'owner@example.test', redirectTo: `${window.location.origin}/reset-password`,
  });
  expect(button()).toBeDisabled();
});

it('shows a failure from the server or from the network and allows another try', async () => {
  vi.mocked(authClient.requestPasswordReset).mockResolvedValueOnce({ data: null, error: { status: 429 } } as never);
  renderCard();
  fireEvent.click(button());
  expect(await screen.findByRole('alert')).toBeInTheDocument();

  vi.mocked(authClient.requestPasswordReset).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(button());
  await waitFor(() => expect(authClient.requestPasswordReset).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(button()).not.toBeDisabled();
});
