import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  __resetCsrfTokenCacheForTests,
  __seedCsrfTokenForTests,
} from '@shared/api/client';
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
  __resetCsrfTokenCacheForTests();
  __seedCsrfTokenForTests('csrf');
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

  it('lets both grid columns shrink so the Conversations card never overflows the viewport', () => {
    const { container } = renderPage(assistantState({ conversations: [conversation()] }));
    // jsdom cannot measure layout: assert the track/item classes that do.
    const grid = container.querySelector('aside')!.parentElement!;
    expect(grid).toHaveClass('grid-cols-[minmax(0,1fr)]', 'lg:grid-cols-[16rem_minmax(0,1fr)]');
    expect(container.querySelector('aside')).toHaveClass('min-w-0');
    expect(container.querySelector('[data-slot="card"]')).toHaveClass('min-w-0');
  });

  it('keeps the composer pinned in a bounded workspace from lg up without breaking the small-screen sticky composer', () => {
    const { container } = renderPage(assistantState({ conversations: [conversation()] }));
    const workspace = container.querySelector('[data-slot="assistant-workspace"]')!;
    // Viewport-bounded from `lg`: the thread scrolls inside, the composer stays visible.
    expect(workspace).toHaveClass(
      'lg:h-[max(32rem,calc(100dvh-18rem))]',
      'lg:grid-rows-[minmax(0,1fr)]',
    );
    const card = container.querySelector('[data-slot="card"]')!;
    expect(card).toHaveClass('lg:min-h-0', 'overflow-hidden', 'max-lg:overflow-clip');
    expect(card.querySelector('form')).toHaveClass('max-lg:sticky', 'max-lg:bottom-0');
    expect(card.querySelector('[data-slot="scroll-area"]')).toHaveClass('lg:min-h-0');
  });

  it('fills AND focuses the composer when a suggestion is clicked, then scrolls it into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderPage();
    await userEvent.click(screen.getByRole('button', {
      name: 'Show me the sites in my account.',
    }));
    const textbox = screen.getByRole('textbox');
    expect(textbox).toHaveValue('Show me the sites in my account.');
    expect(textbox).toHaveFocus();
    expect(scrollIntoView.mock.instances).toContain(textbox);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('survives a suggestion click when there is no composer to focus', async () => {
    api.listAssistantConversations.mockResolvedValue({ conversations: [] });
    renderPage(assistantState({ listStatus: 'failed', listError: genericError }));
    await userEvent.click(screen.getByRole('button', {
      name: 'Show me the sites in my account.',
    }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
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
    // Stopped before the server accepted it: nothing was saved, so the text
    // returns to the composer instead of vanishing.
    expect(screen.getByRole('textbox')).toHaveValue('Stop this response');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('keeps the sent message and marks the reply stopped when Stop lands mid-stream', async () => {
    const saved = conversation();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) => new Promise<Response>((resolve) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode(frame('meta', {
              conversationId: 'c1',
              userMessageId: 'u1',
              assistantMessageId: 'a1',
              responseLocale: 'en',
            })));
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        });
        resolve(new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Content-Language': 'en' },
        }));
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
    await userEvent.type(screen.getByRole('textbox'), 'Give me a 20-step plan');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByText('Give me a 20-step plan', { selector: 'p' })).toBeInTheDocument();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('Response stopped')).toBeInTheDocument();
    expect(screen.getByText('Give me a 20-step plan', { selector: 'p' })).toBeInTheDocument();
    // The message was accepted, so the composer is cleared as for any send.
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('clears the composer the moment a message is sent, before the reply finishes', async () => {
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
        conversations: [conversation()],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Clear me right away');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Still streaming (Stop is offered) and the sent text is already gone.
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByText('0 / 8000 characters')).toBeInTheDocument();
    expect(screen.getByText('Clear me right away', { selector: 'p' })).toBeInTheDocument();
    expect(requestSignal?.aborted).toBe(false);
  });

  it('restores the draft when the send fails before the server confirms it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Boom', code: 'INTERNAL' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderPage(
      assistantState({
        conversations: [conversation()],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Please try again later');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Please try again later');
    // The unconfirmed bubble was withdrawn, so the text is not shown twice.
    expect(screen.queryByText('Please try again later', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('does not restore the draft once the server saved the message and the reply then failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode(frame('meta', {
              conversationId: 'c1',
              userMessageId: 'u1',
              assistantMessageId: 'a1',
              responseLocale: 'en',
            })));
            controller.enqueue(encode(frame('error', {
              code: 'chat_stream_failed',
              messageKey: 'chat.errors.generationFailed',
              message: 'The assistant could not finish this reply. Try again.',
            })));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Content-Language': 'en' },
        },
      ),
    );
    renderPage(
      assistantState({
        conversations: [conversation()],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Saved before failing');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The assistant could not finish this reply. Try again.',
    );
    expect(screen.getByText('Saved before failing', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('retries the earlier prompt without clobbering a newer draft', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Boom', code: 'INTERNAL' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderPage(
      assistantState({
        conversations: [conversation()],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
        stream: {
          ...initialAssistantState.stream,
          status: 'error',
          conversationId: 'c1',
          lastPrompt: 'Earlier prompt',
          error: genericError,
        },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Something new');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // The retry re-sent the earlier prompt, not the new draft...
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toEqual({
      text: 'Earlier prompt',
    });
    await screen.findByRole('alert');
    // ...and left what the user was typing alone.
    expect(screen.getByRole('textbox')).toHaveValue('Something new');
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

  const csrfInvalidBody = {
    error: {
      message: 'CSRF token missing or invalid.',
      code: 'CSRF_INVALID',
      messageKey: 'security.error.csrfInvalid',
    },
  };

  it('keeps the draft and shows the server error when creating the conversation is refused', async () => {
    api.createAssistantConversation.mockRejectedValueOnce(
      new ApiError('forbidden', 403, csrfInvalidBody),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage();
    await userEvent.type(screen.getByRole('textbox'), 'Summarize my latest audit');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CSRF token missing or invalid.');
    expect(screen.getByRole('textbox')).toHaveValue('Summarize my latest audit');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows the server error when the message stays CSRF-rejected after one retry', async () => {
    const csrfRejection = () =>
      new Response(JSON.stringify(csrfInvalidBody), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(csrfRejection())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'fresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(csrfRejection());
    renderPage(
      assistantState({
        conversations: [conversation()],
        activeConversationId: 'c1',
        messagesByConversation: { c1: [] },
        detailStatus: { c1: 'succeeded' },
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'Keep this text');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('CSRF token missing or invalid.');
    expect(screen.getByRole('textbox')).toHaveValue('Keep this text');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
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
