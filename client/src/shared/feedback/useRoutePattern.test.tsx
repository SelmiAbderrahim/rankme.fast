import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom';
import { useRoutePattern } from './useRoutePattern';

const PatternProbe = () => <output data-testid="pattern">{useRoutePattern()}</output>;

describe('useRoutePattern', () => {
  it('derives nested declared paths rather than concrete URL segments', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/sites/:siteId',
          children: [{ path: 'audits/:auditId', element: <PatternProbe /> }],
        },
      ],
      { initialEntries: ['/sites/507f1f77bcf86cd799439011/audits/507f191e810c19729de860ea'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('pattern')).toHaveTextContent('/sites/:siteId/audits/:auditId');
  });

  it('keeps the parent pattern for an index route', () => {
    const router = createMemoryRouter(
      [{ path: '/settings', children: [{ index: true, element: <PatternProbe /> }] }],
      { initialEntries: ['/settings'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('pattern')).toHaveTextContent('/settings');
  });

  it('retains a declared splat route', () => {
    const router = createMemoryRouter([{ path: '/files/*', element: <PatternProbe /> }], {
      initialEntries: ['/files/customer-secret.example/private/report.pdf'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('pattern')).toHaveTextContent('/files/*');
  });

  it('falls back to the root pattern when no router match is available', () => {
    render(<PatternProbe />);
    expect(screen.getByTestId('pattern')).toHaveTextContent('/');
  });

  it('reads declared paths from a declarative router', () => {
    render(
      <MemoryRouter initialEntries={['/sites/abc/pages']}>
        <Routes>
          <Route path="/sites/:siteId">
            <Route path="pages" element={<PatternProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pattern')).toHaveTextContent('/sites/:siteId/pages');
  });
});
