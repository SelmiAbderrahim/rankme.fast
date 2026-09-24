import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {
  isCompetitorWorkspaceView,
  isLandscapeClass,
  useCompetitorWorkspaceView,
  useLegacyCompetitorContentRedirect,
} from './workspaceState';
import { competitorsRoutes } from './routes';
import {
  selectCompetitorDiscovery,
  selectCompetitorProfiles,
  selectLandscapeDetail,
  selectLandscapeRuns,
  selectLandscapeSelection,
} from './store/selectors';
import { initialState } from './store/slice';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function ViewHarness() {
  const [view, setView] = useCompetitorWorkspaceView();
  return (
    <>
      <button type="button" onClick={() => setView('reports')}>{view}</button>
      <Location />
    </>
  );
}

function LegacyHarness() {
  useLegacyCompetitorContentRedirect();
  return <Location />;
}

describe('competitor workspace URL state', () => {
  it('validates workspace views and landscape classes', () => {
    expect(isCompetitorWorkspaceView('overview')).toBe(true);
    expect(isCompetitorWorkspaceView('unknown')).toBe(false);
    expect(isCompetitorWorkspaceView(null)).toBe(false);
    expect(isLandscapeClass('shared_even')).toBe(true);
    expect(isLandscapeClass('all')).toBe(false);
    expect(isLandscapeClass(undefined)).toBe(false);
  });

  it('normalizes invalid and missing views and preserves unrelated params on writes', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=competitors&view=nope&keep=1']}>
        <ViewHarness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('view=overview'));
    await userEvent.click(screen.getByRole('button', { name: 'overview' }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=reports');
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
  });

  it('rewrites the old content competitor bookmark with replace semantics', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=content&view=competitors&keep=1']}>
        <LegacyHarness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('tab=competitors');
      expect(screen.getByTestId('location')).toHaveTextContent('view=content');
      expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
    });
  });

  it('leaves unrelated site URLs unchanged', () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=overview&view=competitors']}>
        <LegacyHarness />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('location')).toHaveTextContent('tab=overview');
  });

  it('preserves old route query params and redirects to the canonical site tab', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/s/competitors?keep=1']}>
        <Routes>
          <Route path={competitorsRoutes[0]!.path} element={competitorsRoutes[0]!.element} />
          <Route path="sites/:siteId" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sites/s?'));
    expect(screen.getByTestId('location')).toHaveTextContent('tab=competitors');
    expect(screen.getByTestId('location')).toHaveTextContent('view=overview');
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
  });

  it('keeps an explicit old-route view and exposes focused intelligence selectors', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/s/competitors?view=reports']}>
        <Routes>
          <Route path={competitorsRoutes[0]!.path} element={competitorsRoutes[0]!.element} />
          <Route path="sites/:siteId" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('view=reports'));
    const root = { competitors: initialState } as never;
    expect(selectCompetitorProfiles(root)).toEqual([]);
    expect(selectCompetitorDiscovery(root)).toBeNull();
    expect(selectLandscapeSelection(root)).toEqual([]);
    expect(selectLandscapeRuns(root)).toEqual([]);
    expect(selectLandscapeDetail(root)).toBeNull();
  });
});
