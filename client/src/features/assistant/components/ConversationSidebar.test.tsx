import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import type { ChatConversation } from '../types';
import { ConversationSidebar } from './ConversationSidebar';

const conversation = (
  id: string,
  title: string,
  lastMessageAt = '2026-08-01T10:00:00.000Z',
): ChatConversation => ({
  id,
  siteId: null,
  title,
  locale: 'en',
  lastMessageAt,
  messageCount: 2,
  createdAt: '2026-08-01T10:00:00.000Z',
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('ConversationSidebar', () => {
  it('renders empty and disabled navigation states', () => {
    const onNew = vi.fn();
    render(
      <ConversationSidebar
        conversations={[]}
        activeConversationId={null}
        disabled
        onNew={onNew}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  });

  it('selects a row, starts a new draft, localizes dates, and preserves invalid dates', async () => {
    const onNew = vi.fn();
    const onSelect = vi.fn();
    render(
      <ConversationSidebar
        conversations={[
          conversation('c1', 'First'),
          conversation('c2', '', 'not-a-date'),
        ]}
        activeConversationId="c1"
        onNew={onNew}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^First/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('not-a-date')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await userEvent.click(screen.getByRole('button', { name: /^First/ }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('c1');
  });

  it('confirms and completes deletion with shared loading feedback', async () => {
    let resolveDelete: ((value: string | null) => void) | undefined;
    const onDelete = vi.fn(
      () => new Promise<string | null>((resolve) => { resolveDelete = resolve; }),
    );
    render(
      <ConversationSidebar
        conversations={[conversation('c1', 'First')]}
        activeConversationId="c1"
        onNew={vi.fn()}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete First' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete conversation?');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: 'Deleting…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    resolveDelete?.(null);
    expect(await screen.findByRole('button', { name: 'Delete First' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the confirmation open on failure and allows cancel after the request', async () => {
    const onDelete = vi.fn().mockResolvedValue('Could not delete this conversation.');
    render(
      <ConversationSidebar
        conversations={[conversation('c1', '')]}
        activeConversationId={null}
        onNew={vi.fn()}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete New conversation' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete this conversation.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
