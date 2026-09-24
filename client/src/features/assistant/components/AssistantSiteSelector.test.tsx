import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import type { Site } from '@features/sites';
import type { ChatConversation } from '../types';
import { AssistantSiteSelector } from './AssistantSiteSelector';

const site: Site = {
  id: 'site-1',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example',
  paused: false,
  pausedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const conversation = (siteId: string | null): ChatConversation => ({
  id: 'c1',
  siteId,
  title: 'Chat',
  locale: 'en',
  lastMessageAt: '2026-08-01T10:00:00.000Z',
  messageCount: 2,
  createdAt: '2026-08-01T10:00:00.000Z',
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AssistantSiteSelector', () => {
  it('selects an optional site and clears it back to general guidance', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AssistantSiteSelector sites={[site]} selectedSiteId={null} onChange={onChange} />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Site context' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('option', { name: 'Example' }));
    expect(onChange).toHaveBeenCalledWith('site-1');

    rerender(
      <AssistantSiteSelector sites={[site]} selectedSiteId="site-1" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Site context' }));
    await userEvent.click(screen.getByRole('option', { name: 'No site — general guidance' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('locks an existing linked site and shows a missing-site fallback', () => {
    render(
      <AssistantSiteSelector
        sites={[]}
        activeConversation={conversation('gone')}
        selectedSiteId={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('Linked site is no longer available')).toBeInTheDocument();
    expect(screen.getByText('Site context is fixed after a conversation starts.')).toBeInTheDocument();
  });

  it('describes loading, unavailable, disabled, and unlinked existing states', () => {
    const { rerender } = render(
      <AssistantSiteSelector sites={[]} selectedSiteId={null} loading onChange={vi.fn()} />,
    );
    expect(screen.getByText('Loading your sites…')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();

    rerender(
      <AssistantSiteSelector
        sites={[]}
        selectedSiteId={null}
        sitesUnavailable
        disabled
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();

    rerender(
      <AssistantSiteSelector
        sites={[{ ...site, displayName: '' }]}
        activeConversation={conversation(null)}
        selectedSiteId="site-1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('No site');
  });
});
