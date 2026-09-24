import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import type { AssistantClientError, ChatMessage } from '../types';
import { AssistantMessagePane } from './AssistantMessagePane';

const error: AssistantClientError = {
  kind: 'generic',
  message: 'Try this request again.',
  status: null,
  retryAfterMs: null,
  code: null,
};

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  status: 'complete',
  responseLocale: null,
  parts: [],
  tokens: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const baseProps = () => ({
  messages: [] as ChatMessage[],
  loadStatus: 'succeeded' as const,
  error: null,
  streaming: false,
  assistantMessageId: null,
  onPromptSelect: vi.fn(),
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AssistantMessagePane', () => {
  it('shows an accessible loading state', () => {
    render(<AssistantMessagePane {...baseProps()} loadStatus="loading" />);
    expect(screen.getByRole('status', { name: 'Loading conversation…' })).toBeInTheDocument();
  });

  it('renders keyboard-operable natural-language starter prompts', async () => {
    const values = baseProps();
    render(<AssistantMessagePane {...values} />);
    expect(screen.getByText('What would you like to improve?')).toBeInTheDocument();
    const prompt = screen.getByRole('button', {
      name: 'Summarize the most important fixes from my latest audit.',
    });
    await userEvent.click(prompt);
    expect(values.onPromptSelect).toHaveBeenCalledWith(prompt.textContent);
  });

  it('renders escaped incoming/outgoing bubbles and pairs tool results once', () => {
    render(
      <AssistantMessagePane
        {...baseProps()}
        messages={[
          message({
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: '<script>unsafe()</script>' }],
          }),
          message({
            id: 'a1',
            parts: [
              { type: 'text', text: 'Safe answer' },
              {
                type: 'tool_call',
                toolCallId: 'tc1',
                toolName: 'list_sites',
                args: {},
              },
              {
                type: 'tool_result',
                toolCallId: 'tc1',
                toolName: 'list_sites',
                ok: true,
                structuredContent: { sites: [] },
              },
              {
                type: 'tool_result',
                toolCallId: 'orphan',
                toolName: 'custom_tool',
                ok: false,
                structuredContent: { reason: 'blocked' },
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText('Your message')).toHaveTextContent('<script>unsafe()</script>');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByLabelText('Assistant response')).toHaveTextContent('Safe answer');
    expect(screen.getAllByText('List sites')).toHaveLength(1);
    expect(screen.getByText('custom_tool')).toBeInTheDocument();
  });

  it('renders assistant replies as markdown and user text literally', () => {
    render(
      <AssistantMessagePane
        {...baseProps()}
        messages={[
          message({
            id: 'u2',
            role: 'user',
            parts: [{ type: 'text', text: '**not bold**' }],
          }),
          message({
            id: 'a2',
            parts: [{ type: 'text', text: '## Fix now\n\n**cashback.sa** needs an H1.' }],
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText('Your message')).toHaveTextContent('**not bold**');
    expect(screen.getByRole('heading', { level: 2, name: 'Fix now' })).toBeInTheDocument();
    expect(screen.getByText('cashback.sa').tagName).toBe('STRONG');
  });

  it('renders mixed-locale assistant artifacts with their own direction and leaves legacy null unknown', () => {
    render(
      <AssistantMessagePane
        {...baseProps()}
        messages={[
          message({
            id: 'ar',
            responseLocale: 'ar',
            parts: [{ type: 'text', text: 'ترتيبك مستقر' }],
          }),
          message({
            id: 'legacy',
            responseLocale: null,
            parts: [{ type: 'text', text: 'Legacy reply' }],
          }),
        ]}
      />,
    );

    const replies = screen.getAllByLabelText('Assistant response');
    expect(replies[0]).toHaveAttribute('lang', 'ar');
    expect(replies[0]).toHaveAttribute('dir', 'rtl');
    expect(replies[0]).toHaveTextContent('ترتيبك مستقر');
    expect(replies[1]).not.toHaveAttribute('lang');
    expect(replies[1]).not.toHaveAttribute('dir');
  });

  it('shows the streaming caret in an existing or connecting assistant bubble', () => {
    const { rerender } = render(
      <AssistantMessagePane
        {...baseProps()}
        messages={[message({ id: 'a1', parts: [{ type: 'text', text: 'Part' }] })]}
        streaming
        assistantMessageId="a1"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Assistant is responding');
    expect(screen.queryByTestId('assistant-connecting-bubble')).not.toBeInTheDocument();

    rerender(
      <AssistantMessagePane
        {...baseProps()}
        messages={[]}
        streaming
        assistantMessageId={null}
      />,
    );
    expect(screen.getByTestId('assistant-connecting-bubble')).toBeInTheDocument();
  });

  it('renders actionable and non-actionable errors', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AssistantMessagePane {...baseProps()} error={error} onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Try this request again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<AssistantMessagePane {...baseProps()} error={error} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
