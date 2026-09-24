import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import {
  sitesReducer,
  type Site,
  type SitesState,
} from '@features/sites';
import type { AssistantClientError, ChatConversation, ChatMessage } from '../types';
import {
  assistantReducer,
  initialAssistantState,
  type AssistantState,
} from '../store/slice';
import { AssistantPage } from './AssistantPage';

const api = vi.hoisted(() => ({
  assistantMessageStreamPath: vi.fn((id: string) => `/chat/conversations/${id}/messages`),
  assistantMessageStreamUrl: vi.fn((id: string) => `/api/chat/conversations/${id}/messages`),
  createAssistantConversation: vi.fn(),
  deleteAssistantConversation: vi.fn(),
  getAssistantConversation: vi.fn(),
  getAssistantCsrfToken: vi.fn(),
  listAssistantConversations: vi.fn(),
}));

const sitesFeature = vi.hoisted(() => ({
  loadSites: vi.fn((input: unknown) => ({ type: 'assistant-test/load-sites', payload: input })),
}));

vi.mock('../api', () => api);
vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'account-a' },
  }),
}));
vi.mock('@features/sites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/sites')>();
  return { ...actual, loadSites: sitesFeature.loadSites };
});

const genericError: AssistantClientError = {
  kind: 'generic',
  message: 'Assistant failed.',
  status: null,
  retryAfterMs: null,
  code: null,
};

const accessError = (kind: AssistantClientError['kind']): AssistantClientError => ({
  ...genericError,
  kind,
  message: `${kind} message`,
});

const conversation = (id = 'c1', siteId: string | null = null): ChatConversation => ({
  id,
  siteId,
  title: `Conversation ${id}`,
  locale: 'en',
  lastMessageAt: '2026-08-01T10:00:00.000Z',
  messageCount: 2,
  createdAt: '2026-08-01T10:00:00.000Z',
});

const message = (id = 'm1', text = 'Stored reply'): ChatMessage => ({
  id,
  role: 'assistant',
  status: 'complete',
  responseLocale: 'en',
  parts: [{ type: 'text', text }],
  tokens: null,
  createdAt: '2026-08-01T10:00:00.000Z',
});

const site: Site = {
  id: 'site-1',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example Site',
  paused: false,
  pausedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const assistantState = (overrides: Partial<AssistantState> = {}): AssistantState => ({
  ...initialAssistantState,
  listStatus: 'succeeded',
  ...overrides,
  stream: {
    ...initialAssistantState.stream,
    ...(overrides.stream ?? {}),
  },
});

const sitesState = (overrides: Partial<SitesState> = {}): SitesState => ({
  ...sitesReducer(undefined, { type: '@@init' }),
  loaded: true,
  items: [site],
  ...overrides,
});

function renderPage(
  assistant = assistantState(),
  sites = sitesState(),
) {
  const store = configureStore({
    reducer: {
      assistant: assistantReducer,
      sites: sitesReducer,
    },
    preloadedState: {
      assistant,
      sites,
    },
  });
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    </Provider>,
  );
  return { ...view, store };
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function streamResponse(text = 'Hello from the assistant.'): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          responseLocale: 'en',
        })));
        controller.enqueue(encode(frame('delta', { text })));
        controller.enqueue(encode(frame('done', {
          finishReason: 'stop',
          tokens: { input: 3, output: 4 },
        })));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Content-Language': 'en',
      },
    },
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  for (const mock of Object.values(api)) mock.mockReset();
  sitesFeature.loadSites.mockClear();
  api.assistantMessageStreamPath.mockImplementation(
    (id: string) => `/chat/conversations/${id}/messages`,
  );
  api.assistantMessageStreamUrl.mockImplementation(
    (id: string) => `/api/chat/conversations/${id}/messages`,
  );
  api.getAssistantCsrfToken.mockResolvedValue('csrf');
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AssistantPage', () => {
  it('loads the list, sites, and selected conversation from idle state', async () => {
    const saved = conversation();
    api.listAssistantConversations.mockResolvedValue({ conversations: [saved] });
    api.getAssistantConversation.mockResolvedValue({
      conversation: saved,
      messages: [message()],
    });
    renderPage(
      assistantState({ listStatus: 'idle' }),
      sitesState({ loaded: false, items: [] }),
    );

    expect(screen.getByRole('status', { name: 'Loading conversations…' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open guide →' })).toHaveAttribute(
      'href',
      '/docs/ai-assistant',
    );
    expect(await screen.findByText('Stored reply')).toBeInTheDocument();
    expect(api.listAssistantConversations).toHaveBeenCalled();
    expect(api.getAssistantConversation).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sitesFeature.loadSites).toHaveBeenCalledWith({});
  });

  it('renders a generic list failure with a retry', async () => {
    api.listAssistantConversations.mockResolvedValue({ conversations: [] });
    renderPage(
      assistantState({ listStatus: 'failed', listError: genericError }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant failed.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('What would you like to improve?')).toBeInTheDocument();
  });

  it('links a site, creates a conversation, and streams the first response', async () => {
    api.createAssistantConversation.mockResolvedValue({
      conversation: conversation('c1', 'site-1'),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse());
    renderPage();

    await userEvent.click(screen.getByRole('combobox', { name: 'Site context' }));
    await userEvent.click(screen.getByRole('option', { name: 'Example Site' }));
    await userEvent.click(screen.getByRole('button', {
      name: 'Show me the sites in my account.',
    }));
    expect(screen.getByRole('textbox')).toHaveValue('Show me the sites in my account.');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Hello from the assistant.')).toBeInTheDocument();
    expect(api.createAssistantConversation).toHaveBeenCalledWith(
      { siteId: 'site-1' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(api.getAssistantConversation).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('selects/new-starts conversations and deletes through the confirmed sidebar action', async () => {
    api.deleteAssistantConversation
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({ ok: true });
    const first = conversation('c1');
    const second = conversation('c2', 'site-1');
    renderPage(
      assistantState({
        conversations: [first, second],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [], c2: [] },
        detailStatus: { c1: 'succeeded', c2: 'succeeded' },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('combobox')).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Conversation c2/ }));
    expect(screen.getByRole('combobox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Conversation c2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteAssistantConversation).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /^Conversation c2/ })).not.toBeInTheDocument();
  });

  it('stops an in-flight response from the composer', async () => {
    const saved = conversation();
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    );
    renderPage(
      assistantState({
        conversations: [saved],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Stop this response');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(await screen.findByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('retries a failed conversation detail', async () => {
    const saved = conversation();
    api.getAssistantConversation.mockResolvedValue({
      conversation: saved,
      messages: [message('m2', 'Recovered history')],
    });
    renderPage(
      assistantState({
        conversations: [saved],
        activeConversationId: 'c1',
        detailStatus: { c1: 'failed' },
        detailError: { c1: genericError },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered history')).toBeInTheDocument();
  });

  it('retries the feature-off unavailable state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse('Recovered response'));
    const saved = conversation();
    renderPage(
      assistantState({
        conversations: [saved],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
        stream: {
          ...initialAssistantState.stream,
          status: 'error',
          conversationId: 'c1',
          lastPrompt: 'Retry me',
          error: accessError('unavailable'),
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered response')).toBeInTheDocument();
  });

  it('retries a failed first-conversation creation using the retained draft', async () => {
    api.createAssistantConversation
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ conversation: conversation() });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse('Created after retry'));
    renderPage();
    await userEvent.click(screen.getByRole('button', {
      name: 'Which tracked keywords changed position recently?',
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Created after retry')).toBeInTheDocument();
  });

  it('leaves a blank failed draft idle when retry has no message to send', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse());
    renderPage(
      assistantState({ createError: genericError, createStatus: 'failed' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.createAssistantConversation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
