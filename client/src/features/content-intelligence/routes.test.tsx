import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { contentIntelligenceRoutes } from './routes';

describe('content intelligence legacy route', () => {
  it.each([
    {
      search: '?filter=open&view=%3Cscript%3E',
      expectedView: 'view=analyses',
    },
    {
      search: '?filter=open&view=inventory',
      expectedView: 'view=inventory',
    },
    {
      search: '?filter=open',
      expectedView: null,
    },
  ])('redirects the site id while preserving and canonicalizing $search', async ({ search, expectedView }) => {
    const Destination = () => {
      const location = useLocation();
      return <p>{location.pathname}{location.search}</p>;
    };
    render(
      <MemoryRouter initialEntries={[`/sites/site%201/content-intelligence${search}`]}>
        <Routes>
          {contentIntelligenceRoutes.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
          <Route path="/sites/:siteId" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    const destination = await screen.findByText(/\/sites\/site%201\?/);
    expect(destination).toHaveTextContent('filter=open');
    if (expectedView) expect(destination).toHaveTextContent(expectedView);
    else expect(destination).not.toHaveTextContent('view=');
    expect(destination).toHaveTextContent('tab=content');
    expect(destination).not.toHaveTextContent('script');
  });
});
