import { act, render, screen } from '@testing-library/react';
import { useContext, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { sitesReducer } from '@features/sites';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AppTitleRegistryContext, useAppTitleDetail, type AppTitleRegistry } from '@shared/navigation/appTitleContext';
import { AppTitleBoundary } from './AppTitleBoundary';

function Content({ main = true }: { main?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return <>
    <Link to="/assistant">Assistant</Link>
    <Link to="/sites/s1?tab=keywords">Keywords</Link>
    <Link to="/denied">Unavailable</Link>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate('/dashboard', { replace: true })}>Replace</button>
    {main && <main id="main-content" tabIndex={-1}>Page</main>}
    {pathname === '/denied' && <Unavailable />}
  </>;
}
function Unavailable() {
  const { t } = useTranslation('common');
  const registered = useAppTitleDetail([t('notFound.title')]);
  return <p>{registered ? 'Named' : 'Standalone'}</p>;
}
function mount(entry = '/dashboard', main = true, probe?: ReactNode) {
  const store = configureStore({ reducer: { sites: sitesReducer } });
  return render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[entry]}><AppTitleBoundary>{probe}<Content main={main} /></AppTitleBoundary></MemoryRouter></I18nextProvider></Provider>);
}
beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  document.title = 'Before the shell';
});

it('announces real navigation and focuses main without changing its scroll position', async () => {
  const user = userEvent.setup();
  const view = mount();
  expect(document.title).toBe('Dashboard · RankMeFast');
  expect(screen.getByRole('status')).toHaveTextContent('');
  const main = screen.getByRole('main');
  main.scrollTop = 120;
  await user.click(screen.getByRole('link', { name: 'Assistant' }));
  expect(document.title).toBe('AI Assistant · RankMeFast');
  expect(screen.getByRole('status')).toHaveTextContent('AI Assistant · RankMeFast');
  expect(main).toHaveFocus();
  expect(main.scrollTop).toBe(120);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(document.title).toBe('Dashboard · RankMeFast');
  expect(main).toHaveFocus();
  view.unmount();
  expect(document.title).toBe('Before the shell');
});

it('announces a changed site tab without pulling focus away from its trigger', async () => {
  const user = userEvent.setup();
  mount('/sites/s1');
  const trigger = screen.getByRole('link', { name: 'Keywords' });
  await user.click(trigger);
  expect(document.title).toBe('Keywords · RankMeFast');
  expect(screen.getByRole('status')).toHaveTextContent('Keywords · RankMeFast');
  expect(trigger).toHaveFocus();
});

it('retitles a refinement and locale, then drops the detail when its route leaves', async () => {
  const user = userEvent.setup();
  mount('/denied');
  expect(screen.getByText('Named')).toBeInTheDocument();
  expect(document.title).toBe(`${i18n.t('notFound.title')} · RankMeFast`);
  await user.click(screen.getByRole('link', { name: 'Assistant' }));
  expect(document.title).toBe('AI Assistant · RankMeFast');
  await act(() => changeLanguage('fr'));
  expect(document.title).toBe(`${i18n.t('nav.assistant')} · RankMeFast`);
  expect(screen.getByRole('status')).toHaveTextContent(document.title);
});

it('does not focus main for replace redirects, and still announces without a main target', async () => {
  const user = userEvent.setup();
  const view = mount('/assistant');
  const replace = screen.getByRole('button', { name: 'Replace' });
  await user.click(replace);
  expect(replace).toHaveFocus();
  expect(document.title).toBe('Dashboard · RankMeFast');
  view.unmount();
  mount('/dashboard', false);
  await user.click(screen.getByRole('link', { name: 'Assistant' }));
  expect(screen.getByRole('status')).toHaveTextContent('AI Assistant · RankMeFast');
});

it('lets shared detail content render without an app title boundary', () => {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Unavailable /></MemoryRouter>);
  expect(screen.getByText('Standalone')).toBeInTheDocument();
});

it('ignores late refinements from a previous location and obsolete cleanup tokens', async () => {
  let registry: AppTitleRegistry;
  let locationKey: string;
  function Probe() {
    registry = useContext(AppTitleRegistryContext)!;
    locationKey = useLocation().key;
    useAppTitleDetail(null);
    return null;
  }
  const user = userEvent.setup();
  mount('/dashboard', true, <Probe />);
  const first = {}, current = {};
  const originalKey = locationKey!;
  act(() => registry.clear(first));
  act(() => registry.set({ token: first, locationKey: originalKey, segments: ['First page'] }));
  act(() => registry.set({ token: current, locationKey: originalKey, segments: ['Current page'] }));
  act(() => registry.clear(first));
  expect(document.title).toBe('Current page · RankMeFast');
  await user.click(screen.getByRole('link', { name: 'Assistant' }));
  act(() => registry.set({ token: current, locationKey: locationKey!, segments: ['Current assistant'] }));
  act(() => registry.set({ token: first, locationKey: originalKey, segments: ['Old late result'] }));
  expect(document.title).toBe('Current assistant · RankMeFast');
  act(() => registry.clear(current));
  act(() => registry.clear(current));
  expect(document.title).toBe('AI Assistant · RankMeFast');
});

it('normalizes optional refinement segments and supports the semantic main fallback', async () => {
  function Detail() {
    useAppTitleDetail(['  Page\n name  ', undefined, null, '']);
    return null;
  }
  const user = userEvent.setup();
  const view = mount('/dashboard', true, <Detail />);
  expect(document.title).toBe('Page name · RankMeFast');
  view.unmount();
  mount();
  const main = screen.getByRole('main');
  main.removeAttribute('id');
  main.removeAttribute('tabindex');
  await user.click(screen.getByRole('link', { name: 'Assistant' }));
  expect(main).toHaveAttribute('tabindex', '-1');
  expect(main).toHaveFocus();
});
