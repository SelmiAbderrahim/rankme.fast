import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import {
  assistantMessageStreamUrl,
  createAssistantConversation,
  deleteAssistantConversation,
  getAssistantConversation,
  getAssistantCsrfToken,
  listAssistantConversations,
} from './api';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
  resolveApiUrl: vi.fn((path: string) => `/api${path}`),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  mockedApiClient.mockReset();
});

describe('assistant API', () => {
  it('creates linked and unlinked conversations with cookie-client CSRF handling', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ conversation: { id: 'one' } } as never)
      .mockResolvedValueOnce({ conversation: { id: 'two' } } as never);
    const controller = new AbortController();

    await createAssistantConversation();
    await createAssistantConversation({ siteId: 'site-1' }, { signal: controller.signal });

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, '/chat/conversations', {
      method: 'POST',
      localeMode: 'artifact',
      body: {},
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, '/chat/conversations', {
      method: 'POST',
      localeMode: 'artifact',
      body: { siteId: 'site-1' },
      signal: controller.signal,
    });
  });

  it('lists conversations with and without a caller signal', async () => {
    mockedApiClient.mockResolvedValue({ conversations: [] } as never);
    const controller = new AbortController();

    await listAssistantConversations();
    await listAssistantConversations({ signal: controller.signal });

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, '/chat/conversations', {
      method: 'GET',
      localeMode: 'artifact',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, '/chat/conversations', {
      method: 'GET',
      localeMode: 'artifact',
      signal: controller.signal,
    });
  });

  it('reads and deletes encoded conversation ids with optional cancellation', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ conversation: {}, messages: [] } as never)
      .mockResolvedValueOnce({ conversation: {}, messages: [] } as never)
      .mockResolvedValueOnce({ ok: true } as never)
      .mockResolvedValueOnce({ ok: true } as never);
    const controller = new AbortController();

    await getAssistantConversation('id/one');
    await getAssistantConversation('id/two', { signal: controller.signal });
    await deleteAssistantConversation('id/one');
    await deleteAssistantConversation('id/two', { signal: controller.signal });

    expect(mockedApiClient).toHaveBeenNthCalledWith(
      1,
      '/chat/conversations/id%2Fone',
      { method: 'GET', localeMode: 'artifact' },
    );
    expect(mockedApiClient).toHaveBeenNthCalledWith(
      2,
      '/chat/conversations/id%2Ftwo',
      { method: 'GET', localeMode: 'artifact', signal: controller.signal },
    );
    expect(mockedApiClient).toHaveBeenNthCalledWith(
      3,
      '/chat/conversations/id%2Fone',
      { method: 'DELETE', localeMode: 'artifact' },
    );
    expect(mockedApiClient).toHaveBeenNthCalledWith(
      4,
      '/chat/conversations/id%2Ftwo',
      { method: 'DELETE', localeMode: 'artifact', signal: controller.signal },
    );
  });

  it('gets the CSRF token with and without a caller signal', async () => {
    mockedApiClient.mockResolvedValue({ csrfToken: 'csrf-1' } as never);
    const controller = new AbortController();

    await expect(getAssistantCsrfToken()).resolves.toBe('csrf-1');
    await expect(
      getAssistantCsrfToken({ signal: controller.signal }),
    ).resolves.toBe('csrf-1');

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, '/security/csrf-token', {
      method: 'GET',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, '/security/csrf-token', {
      method: 'GET',
      signal: controller.signal,
    });
  });

  it('builds an env-derived, encoded stream URL', () => {
    expect(assistantMessageStreamUrl('id/with space')).toBe(
      '/api/chat/conversations/id%2Fwith%20space/messages',
    );
  });
});
