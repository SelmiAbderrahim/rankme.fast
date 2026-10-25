/**
 * The shared site picker isolates each site name, keeps
 * the localized "paused" suffix outside the isolate, and says when the list is
 * partial instead of passing a truncated list for the whole account.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { listOptions } from '@/test/radixSelect';
import type { Site } from '../types';
import { SiteSelect } from './SiteSelect';

const site = (id: string, domain: string, extra: Partial<Site> = {}) =>
  ({ id, domain, displayName: '', ...extra }) as Site;

const renderSelect = (sites: Site[], truncated: boolean) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SiteSelect
          id="pick"
          testId="pick"
          value={null}
          onChange={vi.fn()}
          placeholder="Choose a site"
          sites={{ status: 'ready', sites, truncated, retry: vi.fn() }}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('SiteSelect', () => {
  it('isolates the site name and keeps the paused suffix outside it', async () => {
    renderSelect(
      [
        site('a', 'shop.example', { displayName: 'متجر' }),
        site('b', 'paused.example', { paused: true }),
      ],
      false,
    );
    const user = userEvent.setup();
    expect(await listOptions(user, screen.getByTestId('pick'))).toEqual([
      'متجر · shop.example',
      'paused.example (paused)',
    ]);
    await user.click(screen.getByTestId('pick'));
    const listbox = await screen.findByRole('listbox');
    const paused = within(listbox).getByRole('option', { name: 'paused.example (paused)' });
    expect(Array.from(paused.querySelectorAll('bdi'), (bdi) => bdi.textContent)).toEqual([
      'paused.example',
    ]);
    expect(screen.queryByTestId('pick-truncated')).toBeNull();
  });

  it('says how many sites it lists when more exist than it could read', async () => {
    renderSelect([site('a', 'a.example'), site('b', 'b.example')], true);
    expect(screen.getByTestId('pick-truncated')).toHaveTextContent(
      'Only your first 2 sites are listed here.',
    );
    await act(async () => {
      await changeLanguage('de');
    });
    const many = Array.from({ length: 1_000 }, (_, index) =>
      site(`s${index}`, `s${index}.example`),
    );
    renderSelect(many, true);
    expect(screen.getAllByTestId('pick-truncated')[1]).toHaveTextContent(
      'Hier werden nur Ihre ersten 1.000 Websites aufgeführt.',
    );
  });
});

it('exposes loading, retry, empty and selection states without returning partial options as complete', async () => {
  const retry = vi.fn();
  const onChange = vi.fn();
  const a = site('a', 'a.example');
  const b = site('b', 'b.example');
  const props = {
    id: 'form-site',
    testId: 'form-site',
    value: 'b',
    onChange,
    placeholder: 'Choose a site',
  };
  const mount = (state: import('../useAllSites').AllSitesState) => (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SiteSelect {...props} invalid describedBy="help" sites={{ ...state, retry }} />
      </MemoryRouter>
    </I18nextProvider>
  );
  const view = render(mount({ status: 'loading', sites: [] }));
  expect(screen.getByTestId('form-site-loading')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByTestId('form-site-loading')).toHaveTextContent('Loading your sites…');
  view.rerender(mount({ status: 'error', sites: [a] }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load your sites.');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox')).toBeNull();
  view.rerender(mount({ status: 'ready', sites: [], truncated: false }));
  expect(screen.getByTestId('form-site-empty')).toHaveTextContent('You have no sites yet.');
  expect(screen.getByRole('link', { name: 'Add a site' })).toHaveAttribute('href', '/sites');
  view.rerender(mount({ status: 'ready', sites: [a, b], truncated: false }));
  expect(screen.getByRole('combobox')).toHaveTextContent('b.example');
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 'help');
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(screen.getByRole('option', { name: 'a.example' }));
  expect(onChange).toHaveBeenCalledWith(a);
});

it('uses the placeholder for an unknown selection and mirrors the options in RTL', async () => {
  await act(async () => {
    await changeLanguage('ar');
  });
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SiteSelect
          id="rtl"
          testId="rtl"
          value="missing"
          onChange={vi.fn()}
          placeholder="اختر موقعًا"
          sites={{
            status: 'ready',
            sites: [site('a', 'a.example')],
            truncated: false,
            retry: vi.fn(),
          }}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(screen.getByRole('combobox')).toHaveTextContent('اختر موقعًا');
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByRole('listbox')).toHaveAttribute('dir', 'rtl');
});
