import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuditFindingSourceRedirect, actionsRoutes } from './routes';

const Probe = () => {
  const location = useLocation();
  return (
    <div data-testid="landed">
      {location.pathname}
      {location.search}
    </div>
  );
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {actionsRoutes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('actions source deep-link resolvers', () => {
  it('resolves an audit finding link onto the shipped report run route', () => {
    renderAt('/sites/s1/audits/run-9/findings/title-missing');
    expect(screen.getByTestId('landed')).toHaveTextContent(
      '/sites/s1/report/run-9?finding=title-missing',
    );
  });

  it.each([
    ['/sites/s1/ranks/drops/kw-1', '/sites/s1?tab=keywords'],
    ['/sites/s1/gsc/declines/q-1', '/sites/s1?tab=google'],
    ['/sites/s1/ga4/declines/m-1', '/sites/s1?tab=google'],
    [
      '/sites/s1/content-intelligence/an-1/recommendations/rec-1',
      '/sites/s1?tab=content',
    ],
    ['/sites/s1/content-intelligence/citation-gaps/gap-1', '/sites/s1?tab=content'],
  ])('resolves %s onto its workspace tab', (from, to) => {
    renderAt(from);
    expect(screen.getByTestId('landed')).toHaveTextContent(to);
  });

  it('resolves an audience research signal link with the signal drawer param', () => {
    renderAt('/sites/s1/audience-research/sig-7');
    expect(screen.getByTestId('landed')).toHaveTextContent(
      '/sites/s1?tab=audience-research&signal=sig-7',
    );
  });

  it('falls back to empty path segments when a resolver mounts without params', () => {
    // A resolver rendered outside its parameterized route (e.g. a future
    // route refactor dropping a param) must degrade to empty segments
    // instead of crashing on undefined.
    render(
      <MemoryRouter initialEntries={['/orphan']}>
        <Routes>
          <Route path="/orphan" element={<AuditFindingSourceRedirect />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    // React Router collapses the empty segments during navigation.
    expect(screen.getByTestId('landed')).toHaveTextContent('/sites/report/?finding=');
  });

  it('URL-encodes hostile path params instead of passing them through raw', () => {
    renderAt('/sites/s%2F..%2Fx/ranks/drops/kw-1');
    // React Router decodes %2F into the param; the resolver re-encodes it so
    // the redirect target cannot escape the /sites/ prefix.
    expect(screen.getByTestId('landed')).toHaveTextContent(
      '/sites/s%2F..%2Fx?tab=keywords',
    );
  });
});
