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

  it('collapses the list behind a toggle for small screens and re-collapses on select', async () => {
    const onSelect = vi.fn();
    render(
      <ConversationSidebar
        conversations={[conversation('c1', 'First'), conversation('c2', 'Second')]}
        activeConversationId={null}
        onNew={vi.fn()}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Show conversations (2)' });
    const list = document.querySelector('[data-slot="conversation-scroll"]')!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    expect(toggle).toHaveClass('lg:hidden');
    // Collapsed below `lg`, but always shown from `lg` up.
    expect(list).toHaveClass('hidden', 'lg:block');

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide conversations' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(list).not.toHaveClass('hidden');

    await userEvent.click(screen.getByRole('button', { name: /^Second/ }));
    expect(onSelect).toHaveBeenCalledWith('c2');
    expect(list).toHaveClass('hidden');
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

  it('lets long titles truncate and keeps Delete inside the card (layout contract)', () => {
    const title = 'Summarize the most important fixes from my latest audit.';
    const { container } = render(
      <ConversationSidebar
        conversations={[conversation('c1', title)]}
        activeConversationId={null}
        onNew={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // jsdom cannot measure layout, so assert the shrink chain that does.
    expect(container.querySelector('aside')).toHaveClass('min-w-0');
    // No Radix ScrollArea: its `display: table` wrapper defeats truncation.
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toBeNull();
    const scroller = container.querySelector('[data-slot="conversation-scroll"]');
    expect(scroller).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(screen.getByRole('navigation')).toHaveClass('min-w-0');

    const titleEl = screen.getByText(title);
    expect(titleEl).toHaveClass('block', 'truncate');
    expect(titleEl.parentElement).toHaveClass('min-w-0', 'flex-1');
    const selectBtn = titleEl.closest('button')!;
    expect(selectBtn).toHaveClass('min-w-0', 'flex-1');
    const row = selectBtn.parentElement!;
    expect(row).toHaveClass('flex', 'min-w-0');

    const del = screen.getByRole('button', { name: `Delete ${title}` });
    expect(del).toHaveClass('shrink-0', 'me-1');
    expect(del.parentElement).toBe(row);
    expect(del.className).not.toMatch(/\bm[lr]-/);
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
