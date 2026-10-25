import { beforeEach, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { authClient } from '../authClient';
import { ActiveSessions } from './ActiveSessions';

vi.mock('../authClient', () => ({
  authClient: {
    useSession: vi.fn(),
    listSessions: vi.fn(),
    $fetch: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
}));
vi.mock('./SessionReauth', () => ({
  SessionReauth: ({ onConfirmed }: { onConfirmed: () => Promise<void> }) => (
    <button type="button" onClick={() => void onConfirmed()}>mock confirm</button>
  ),
}));

const useSession = authClient.useSession as unknown as Mock;
const listSessions = authClient.listSessions as unknown as Mock;
const revokeSession = authClient.$fetch as unknown as Mock;
const stale = { data: null, error: { status: 403, code: 'SESSION_NOT_FRESH' } };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  initI18n({ initialLocale: 'en' });
});

const renderSessions = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><ActiveSessions /></MemoryRouter></I18nextProvider>);

it('retires the stale session and reloads after a fresh confirmation', async () => {
  useSession.mockReturnValue({ data: { session: { id: 'old' }, user: { id: 'u1', email: 'owner@example.test' } } });
  listSessions.mockResolvedValueOnce(stale).mockResolvedValueOnce({ data: [{ id: 'new' }], error: null });
  revokeSession.mockResolvedValue({ data: null, error: null });
  renderSessions();
  fireEvent.click(await screen.findByRole('button', { name: 'mock confirm' }));
  await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('/revoke-session', { method: 'POST', body: { sessionId: 'old' } }));
  await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('button', { name: 'Revoke' })).toBeInTheDocument();
});

it('reloads even when the stale session cannot be revoked or is unknown', async () => {
  useSession.mockReturnValue({ data: { session: { id: 'old' }, user: { id: 'u1' } } });
  listSessions.mockResolvedValueOnce(stale).mockResolvedValueOnce({ data: [], error: null });
  revokeSession.mockRejectedValue(new Error('offline'));
  renderSessions();
  fireEvent.click(await screen.findByRole('button', { name: 'mock confirm' }));
  await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  cleanup();

  useSession.mockReturnValue({ data: null });
  listSessions.mockResolvedValueOnce(stale).mockResolvedValueOnce({ data: [], error: null });
  revokeSession.mockClear();
  renderSessions();
  fireEvent.click(await screen.findByRole('button', { name: 'mock confirm' }));
  await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(4));
  expect(revokeSession).not.toHaveBeenCalled();
});
