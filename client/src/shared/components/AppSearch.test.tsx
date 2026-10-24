import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { loadSites, sitesReducer, type Site } from '@features/sites';
import { workspaceInitialState, workspaceReducer } from '@features/workspace';
import { initI18n } from '@shared/i18n';
import { AppSearch } from './AppSearch';

const site = (id: string, paused = false): Site => ({
  id, domain: `${id}.example`, url: `https://${id}.example/secret-path`, displayName: `${id} shop`, paused,
  pausedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});
const Location = () => { const location = useLocation(); return <p data-testid="location">{location.pathname}{location.search}</p>; };
const mount = (path = '/dashboard', sites = [site('first'), site('second')], loaded = true) => {
  const store = configureStore({
    reducer: { sites: sitesReducer, workspace: workspaceReducer },
    preloadedState: {
      sites: { ...sitesReducer(undefined, { type: '@@init' }), items: sites, loaded },
      workspace: workspaceInitialState,
    },
  });
  render(<Provider store={store}><MemoryRouter initialEntries={[path]}><AppSearch /><Location /></MemoryRouter></Provider>);
  return Object.assign(userEvent.setup(), { store });
};
const input = () => screen.getByRole('combobox', { name: 'Search' });
beforeEach(() => { initI18n({ initialLocale: 'en' }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('header search destinations', () => {
  it('keeps a valid selection when the site results shrink', async () => {
    const user = mount();
    await user.click(input());
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Docs' })).toHaveAttribute('aria-selected', 'true');
    act(() => { user.store.dispatch(loadSites.fulfilled({ sites: [], nextCursor: null }, 'refresh', {})); });
    expect(screen.getByRole('option', { name: 'Docs' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Security' })).toHaveAttribute('aria-selected', 'true');
  });
  it('reopens the first or last result with an arrow key after dismissal', async () => {
    const user = mount();
    await user.click(input());
    await user.keyboard('{Escape}{ArrowDown}');
    let options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}{ArrowUp}');
    options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true');
  });
  it('returns focus to the mobile search button after Escape', async () => {
    const user = mount();
    const trigger = screen.getByRole('button', { name: 'Search' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    expect(within(dialog).getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('loads sites on first focus so tools work on a fresh dashboard', async () => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = vi.fn((url: string) => {
      if (!url.endsWith('/sites')) throw new Error(`Unexpected request: ${url}`);
      return response;
    });
    vi.stubGlobal('fetch', fetch);
    const user = mount('/dashboard', [], false);
    expect(fetch).not.toHaveBeenCalled();
    await user.type(input(), 'Backlinks');
    expect(screen.getByText('Loading your sites…')).toBeInTheDocument();
    await act(async () => { finish(new Response(JSON.stringify({ sites: [site('loaded')], nextCursor: null }), { headers: { 'Content-Type': 'application/json' } })); });
    const tools = await screen.findByRole('group', { name: 'Site tools' });
    expect(within(tools).getByRole('option', { name: /Backlinks.*loaded shop/ })).toBeInTheDocument();
    expect(screen.queryByText('Loading your sites…')).not.toBeInTheDocument();
  });
  it('finds a workspace tool for the current site by its visible name', async () => {
    const user = mount('/sites/second?tab=overview');
    await user.type(input(), 'Backlinks');
    const tools = screen.getByRole('group', { name: 'Site tools' });
    expect(screen.getByRole('link', { name: /Search the docs for.*Backlinks/ })).toHaveAttribute('href', '/docs?q=Backlinks');
    expect(within(tools).getAllByRole('option')).toHaveLength(1);
    await user.click(within(tools).getByRole('option', { name: /Backlinks.*second shop/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sites/second?tab=backlinks');
  });

  it('offers each matching tool per site outside a workspace, with active sites first', async () => {
    const user = mount('/dashboard', [site('paused', true), site('active')]);
    await user.type(input(), 'Backlinks');
    const options = within(screen.getByRole('group', { name: 'Site tools' })).getAllByRole('option');
    expect(options[0]).toHaveTextContent('active shop');
    expect(options[1]).toHaveTextContent('paused shop');
  });

  it('matches tool groups and excludes hidden URL paths from site search', async () => {
    const user = mount('/sites/first');
    await user.type(input(), 'Visibility');
    expect(within(screen.getByRole('group', { name: 'Site tools' })).getByRole('option', { name: /Backlinks/ })).toBeInTheDocument();
    await user.clear(input());
    await user.type(input(), 'secret-path');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No results');
  });

  it('groups Docs separately and offers an encoded documentation search for unmatched text', async () => {
    const user = mount();
    await user.click(input());
    expect(within(screen.getByRole('group', { name: 'Docs' })).getByRole('option', { name: 'Docs' })).toBeInTheDocument();
    await user.type(input(), 'why & how?');
    const fallback = screen.getByRole('link', { name: /Search the docs for.*why & how\?/ });
    expect(fallback).toHaveAttribute('href', '/docs?q=why%20%26%20how%3F');
    expect(fallback).toHaveAttribute('rel', 'noopener noreferrer');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
  });

  it('scrolls the results list to the highlighted row without scrolling the document', async () => {
    const user = mount();
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    await user.click(input());
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 110 } as DOMRect);
    vi.spyOn(options[1]!, 'getBoundingClientRect').mockReturnValue({ top: 110, bottom: 150 } as DOMRect);
    await user.keyboard('{ArrowDown}');
    expect(list.scrollTop).toBe(40);
    vi.spyOn(options[0]!, 'getBoundingClientRect').mockReturnValue({ top: -20, bottom: 20 } as DOMRect);
    await user.keyboard('{ArrowUp}');
    expect(list.scrollTop).toBe(10);
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });
});
