import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { sitesReducer } from '../store/slice';
import { AddSiteForm } from './AddSiteForm';
import { SitesPage } from './SitesPage';
import { SitesTable } from './SitesTable';
import type { Site, SitesState } from '../types';

/** Walk React fiber upward from a DOM element to find a memoizedProps.onOpenChange. */
type FiberNode = { memoizedProps?: Record<string, unknown>; return: FiberNode | null };
function getFiberOnOpenChange(el: Element): ((open: boolean) => void) | null {
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
  if (!fiberKey) return null;
  let node: FiberNode | null = (el as unknown as Record<string, FiberNode>)[fiberKey] ?? null;
  while (node) {
    if (typeof node.memoizedProps?.onOpenChange === 'function') {
      return node.memoizedProps.onOpenChange as (open: boolean) => void;
    }
    node = node.return;
  }
  return null;
}

vi.mock('../api', () => ({
  fetchSitesRequest: vi.fn(),
  createSiteRequest: vi.fn(),
  deleteSiteRequest: vi.fn(),
  updateSiteRequest: vi.fn(),
  pauseSiteRequest: vi.fn(),
  resumeSiteRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const site = (id: string, overrides: Partial<Site> = {}): Site => ({
  id,
  url: `https://${id}.example.com`,
  domain: `${id}.example.com`,
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const baseState = (): SitesState => sitesReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<SitesState>) =>
  configureStore({
    reducer: { sites: sitesReducer },
    preloadedState: {
      sites: { ...baseState(), ...(preloaded ?? {}) },
    },
  });

type SitesStore = ReturnType<typeof makeStore>;

const renderWith = (ui: React.ReactNode, store: SitesStore = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.fetchSitesRequest.mockResolvedValue({ sites: [], nextCursor: null });
});

describe('AddSiteForm', () => {
  it('renders label, placeholder, and the primary submit', () => {
    renderWith(<AddSiteForm />);
    expect(screen.getByLabelText('Site URL')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add site' })).toBeInTheDocument();
  });

  it('shows an inline, linked validation error for an invalid URL', async () => {
    const user = userEvent.setup();
    renderWith(<AddSiteForm />);
    const input = screen.getByLabelText('Site URL');
    await user.type(input, 'ftp://example.com');
    await user.click(screen.getByRole('button', { name: 'Add site' }));

    const error = await screen.findByText('Only http:// and https:// URLs are supported.');
    expect(error).toHaveAttribute('id', 'site-url-error');
    expect(input).toHaveAttribute('aria-describedby', 'site-url-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mocked.createSiteRequest).not.toHaveBeenCalled();
  });

  it('submits a valid URL, resets the input, and reloads the list', async () => {
    const user = userEvent.setup();
    mocked.createSiteRequest.mockResolvedValue({
      site: site('new'),
      message: 'Site added.',
    });
    renderWith(<AddSiteForm />);
    const input = screen.getByLabelText('Site URL');
    await user.type(input, 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Add site' }));

    await waitFor(() =>
      expect(mocked.createSiteRequest).toHaveBeenCalledWith('https://example.com'),
    );
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalled());
    expect(input).toHaveValue('');
  });

  it('surfaces the server error and keeps the list untouched on failure', async () => {
    const user = userEvent.setup();
    mocked.createSiteRequest.mockRejectedValue(new TypeError('offline'));
    renderWith(<AddSiteForm />);
    await user.type(screen.getByLabelText('Site URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Add site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the site.');
    expect(mocked.fetchSitesRequest).not.toHaveBeenCalled();
  });

  it('shows the busy label while adding', () => {
    renderWith(<AddSiteForm />, makeStore({ adding: true }));
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });

  it('renders no Run audit toggle (audit gate removed)', () => {
    renderWith(<AddSiteForm />);
    expect(screen.queryByRole('button', { name: 'Run audit' })).toBeNull();
    expect(screen.queryByText(/audits are coming soon/i)).toBeNull();
  });
});

describe('SitesPage', () => {
  it('shows the skeleton loading state before the list arrives', () => {
    renderWith(<SitesPage />, makeStore({ loading: true }));
    expect(screen.getByText('Loading your sites…')).toBeInTheDocument();
    expect(screen.getByTestId('sites-skeleton')).toBeInTheDocument();
  });

  it('loads on mount and renders the empty state with the add form', async () => {
    renderWith(<SitesPage />);
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('No sites yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first site to get started.')).toBeInTheDocument();
    expect(screen.getByLabelText('Site URL')).toBeInTheDocument();
  });

  it('renders the error state with a working retry', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, error: 'Could not load your sites.' });
    renderWith(<SitesPage />, store);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your sites.');

    mocked.fetchSitesRequest.mockResolvedValue({ sites: [site('a')], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalled());
    expect((await screen.findAllByText('a.example.com')).length).toBeGreaterThan(0);
  });

  it('renders the table with names, domains, and dates', () => {
    const store = makeStore({
      loaded: true,
      items: [site('a', { displayName: 'My blog' }), site('b')],
    });
    renderWith(<SitesPage />, store);
    expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument();
    // Desktop table + mobile cards both render the site name.
    expect(screen.getAllByText('My blog').length).toBeGreaterThan(0);
    expect(screen.getAllByText('b.example.com').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Added' })).toBeInTheDocument();
  });

  it('paginates forward and back through cursors', async () => {
    const user = userEvent.setup();
    const store = makeStore({
      loaded: true,
      items: [site('a')],
      nextCursor: 'c2',
      cursorStack: [],
    });
    renderWith(<SitesPage />, store);

    mocked.fetchSitesRequest.mockResolvedValue({ sites: [site('b')], nextCursor: null });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalledWith('c2'));

    // Back to the first page (cursor null popped off the stack).
    mocked.fetchSitesRequest.mockResolvedValue({ sites: [site('a')], nextCursor: 'c2' });
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalledWith(null));
  });

  it('walks the full delete flow: menu → confirm dialog → API → reload', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, items: [site('a')] });
    mocked.deleteSiteRequest.mockResolvedValue({ message: 'Site removed.' });
    renderWith(<SitesPage />, store);

    const [menuButton] = screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    });
    await user.click(menuButton!);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'This removes a.example.com from your account.',
    );
    await user.click(screen.getByRole('button', { name: 'Delete site' }));

    await waitFor(() => expect(mocked.deleteSiteRequest).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(mocked.fetchSitesRequest).toHaveBeenCalled());
  });

  it('cancel closes the confirm dialog without deleting', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, items: [site('a')] });
    renderWith(<SitesPage />, store);

    const [menuButton] = screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    });
    await user.click(menuButton!);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(mocked.deleteSiteRequest).not.toHaveBeenCalled();
  });

  it('shows the delete error alert and does not reload on failure', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, items: [site('a')] });
    mocked.deleteSiteRequest.mockRejectedValue(new TypeError('offline'));
    renderWith(<SitesPage />, store);

    const [menuButton] = screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    });
    await user.click(menuButton!);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete the site.');
    expect(mocked.fetchSitesRequest).not.toHaveBeenCalled();
  });

  it('renders Backlinks and Competitors items in the row menu', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, items: [site('a')] });
    renderWith(<SitesPage />, store);
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    const competitors = await screen.findByRole('menuitem', { name: 'Competitors' });
    expect(competitors).toHaveAttribute('href', '/sites/a?tab=competitors');
    expect(
      screen.getByRole('menuitem', { name: 'Backlinks' }),
    ).toHaveAttribute('href', '/sites/a?tab=backlinks');
  });

});

describe('SitesTable', () => {
  it('disables the row menu while that site is deleting', () => {
    renderWith(
      <SitesTable sites={[site('a')]} deletingId="a" onDelete={vi.fn()} />,
    );
    for (const button of screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    })) {
      expect(button).toBeDisabled();
    }
  });

  it('sorts by a column ascending then descending on repeated header clicks', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable
        sites={[site('b'), site('a')]}
        deletingId={null}
        onDelete={vi.fn()}
      />,
    );
    const firstMenu = () =>
      screen.getAllByRole('button', { name: /Open menu for/ })[0]!;
    // Unsorted: input order preserved (b first).
    expect(firstMenu()).toHaveAccessibleName('Open menu for b.example.com');

    await user.click(screen.getByRole('button', { name: 'Domain' })); // ascending → a
    expect(firstMenu()).toHaveAccessibleName('Open menu for a.example.com');
    expect(screen.getByRole('columnheader', { name: 'Domain' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await user.click(screen.getByRole('button', { name: 'Domain' })); // descending → b
    expect(firstMenu()).toHaveAccessibleName('Open menu for b.example.com');
    expect(screen.getByRole('columnheader', { name: 'Domain' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(screen.getByRole('button', { name: 'Domain' })); // back to ascending → a
    expect(firstMenu()).toHaveAccessibleName('Open menu for a.example.com');

    // Sorting by the other columns exercises every sort key + aria-sort.
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: 'Added' }));
    expect(screen.getByRole('columnheader', { name: 'Added' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('renders always-on menu items with correct link targets', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    const [menuButton] = screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    });
    await user.click(menuButton!);

    const viewReport = await screen.findByRole('menuitem', { name: 'View report' });
    expect(viewReport).toHaveAttribute('href', '/sites/a?tab=report');
    expect(
      screen.getByRole('menuitem', { name: 'Track keywords' }),
    ).toHaveAttribute('href', '/sites/a?tab=keywords');
    expect(
      screen.getByRole('menuitem', { name: 'Google settings' }),
    ).toHaveAttribute('href', '/sites/a?tab=google');
    expect(screen.getByRole('menuitem', { name: 'Edit display name' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('opens the rename dialog, saves, updates the row, and closes', async () => {
    const user = userEvent.setup();
    mocked.updateSiteRequest.mockResolvedValue({
      site: site('a', { displayName: 'My blog' }),
      message: 'Site updated.',
    });
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));

    const dialog = await screen.findByRole('dialog');
    const input = screen.getByLabelText('Display name');
    await user.clear(input);
    await user.type(input, '  My blog  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocked.updateSiteRequest).toHaveBeenCalledWith('a', 'My blog'),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('surfaces a rename failure inline and keeps the dialog open', async () => {
    const user = userEvent.setup();
    mocked.updateSiteRequest.mockRejectedValue(new TypeError('offline'));
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));
    await user.type(screen.getByLabelText('Display name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update the site.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancel closes the rename dialog without dispatching', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocked.updateSiteRequest).not.toHaveBeenCalled();
  });

  it('links the site name to the workspace and leads the row menu with an Open action', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    const nameLinks = screen.getAllByRole('link', { name: 'a.example.com' });
    expect(nameLinks.length).toBeGreaterThan(0);
    for (const link of nameLinks) {
      expect(link).toHaveAttribute('href', '/sites/a');
    }
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toHaveAttribute(
      'href',
      '/sites/a',
    );
  });

  it('shows the shared in-button spinner + aria-busy while a rename is in flight', async () => {
    const user = userEvent.setup();
    // A never-resolving update keeps the Save button in its pending state.
    mocked.updateSiteRequest.mockReturnValue(new Promise(() => {}));
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));
    await user.type(screen.getByLabelText('Display name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saveBtn = await screen.findByRole('button', { name: /Saving/ });
    expect(saveBtn).toHaveAttribute('aria-busy', 'true');
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.querySelector('[data-slot="spinner"]')).toBeTruthy();
  });

  it('pressing Escape closes the rename dialog via onOpenChange', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('AlertDialog onOpenChange(true) is a no-op — false branch of if(!open)', async () => {
    // Open the delete confirm dialog, then call onOpenChange(true) directly via
    // the React fiber to exercise the false branch (open=true → nothing happens).
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const alertDialog = await screen.findByRole('alertdialog');
    const onOpenChange = getFiberOnOpenChange(alertDialog);
    expect(onOpenChange).toBeTruthy();
    act(() => onOpenChange!(true));
    // Dialog remains open (the false branch is a no-op)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('Dialog onOpenChange(true) is a no-op — false branch of if(!open)', async () => {
    // Open the rename dialog, then call onOpenChange(true) directly via the
    // React fiber to exercise the false branch (open=true → closeRename not called).
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit display name' }));
    const dialog = await screen.findByRole('dialog');
    const onOpenChange = getFiberOnOpenChange(dialog);
    expect(onOpenChange).toBeTruthy();
    act(() => onOpenChange!(true));
    // Dialog remains open (the false branch is a no-op)
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('SitesTable — pause and resume', () => {
  const pausedSite = () =>
    site('a', { paused: true, pausedAt: '2026-07-30T00:00:00.000Z' });

  it('renders the warning Paused chip in the desktop cell and the mobile card', () => {
    renderWith(
      <SitesTable sites={[pausedSite()]} deletingId={null} onDelete={vi.fn()} />,
    );
    const chips = screen.getAllByTestId('site-paused-chip-a');
    // Desktop name cell + mobile card.
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip).toHaveAttribute('data-slot', 'status-chip');
      expect(chip).toHaveAttribute('data-tone', 'warning');
      expect(chip).toHaveTextContent('Paused');
    }
  });

  it('renders no chip for an unpaused site', () => {
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId('site-paused-chip-a')).toBeNull();
  });

  it('walks the full pause flow: menu → confirm dialog → API dispatch → close', async () => {
    const user = userEvent.setup();
    mocked.pauseSiteRequest.mockResolvedValue({
      site: pausedSite(),
      message: 'Site paused.',
    });
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    expect(screen.queryByRole('menuitem', { name: 'Resume site' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Pause site' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Pause this site?');
    expect(dialog).toHaveTextContent(
      'Audits, rank checks, weekly reports, content monitoring, and alerts stop for a.example.com.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Pause site' }));

    await waitFor(() => expect(mocked.pauseSiteRequest).toHaveBeenCalledWith('a'));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('cancel closes the pause confirm dialog without dispatching', async () => {
    const user = userEvent.setup();
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Pause site' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(mocked.pauseSiteRequest).not.toHaveBeenCalled();
  });

  it('a paused site offers Resume site and dispatches immediately (no dialog)', async () => {
    const user = userEvent.setup();
    mocked.resumeSiteRequest.mockResolvedValue({
      site: site('a'),
      message: 'Site resumed.',
    });
    renderWith(
      <SitesTable sites={[pausedSite()]} deletingId={null} onDelete={vi.fn()} />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Open menu for a.example.com' })[0]!,
    );
    expect(screen.queryByRole('menuitem', { name: 'Pause site' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Resume site' }));

    await waitFor(() => expect(mocked.resumeSiteRequest).toHaveBeenCalledWith('a'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('disables the row menu while that site has a pause/resume in flight', () => {
    renderWith(
      <SitesTable sites={[site('a')]} deletingId={null} onDelete={vi.fn()} />,
      makeStore({ pausingId: 'a' }),
    );
    for (const button of screen.getAllByRole('button', {
      name: 'Open menu for a.example.com',
    })) {
      expect(button).toBeDisabled();
    }
  });

});

describe('RTL (ar)', () => {
  it('renders the add-site form and list right-to-left with Arabic copy', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');

    const store = makeStore({ loaded: true, items: [site('a')] });
    renderWith(
      <>
        <AddSiteForm />
        <SitesPage />
      </>,
      store,
    );

    expect(screen.getAllByLabelText('عنوان URL للموقع').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'إضافة موقع' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'المواقع' })).toBeInTheDocument();
  });
});
