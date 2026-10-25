import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { SessionReconnect } from './SessionReconnect';

const session = vi.hoisted(() => ({ value: { refetch: undefined as undefined | (() => Promise<void>), isRefetching: false } }));
vi.mock('../useAuthSession', () => ({ useAuthSession: () => session.value }));

beforeEach(() => initI18n({ initialLocale: 'en' }));

const renderReconnect = () => render(<I18nextProvider i18n={i18n}><SessionReconnect /></I18nextProvider>);

it('retries the session read from the retry button', () => {
  const refetch = vi.fn(async () => undefined);
  session.value = { refetch, isRefetching: false };
  renderReconnect();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('retry', { ns: 'common' }) }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('disables the button while a read is running and tolerates a missing refetch', () => {
  session.value = { refetch: undefined, isRefetching: true };
  const { unmount } = renderReconnect();
  expect(screen.getByRole('button')).toBeDisabled();
  unmount();
  session.value = { refetch: undefined, isRefetching: false };
  renderReconnect();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByTestId('session-reconnect')).toBeInTheDocument();
});
