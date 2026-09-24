import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import type { HeaderProps } from './Header';
import { PublicLayout } from './PublicLayout';

const headerProps = vi.hoisted(() => ({ current: null as HeaderProps | null }));

vi.mock('./Header', () => ({
  Header: (props: HeaderProps) => {
    headerProps.current = props;
    return (
      <button type="button" onClick={() => props.onLocaleChange?.('fr')}>
        switch locale
      </button>
    );
  },
}));

vi.mock('./Footer', () => ({
  Footer: () => <footer />,
}));

vi.mock('./ReleaseStageBanner', () => ({
  ReleaseStageBanner: () => null,
}));

const renderPath = (path: string) => {
  const router = createMemoryRouter(
    [
      { path: '/docs/*', element: <PublicLayout />, children: [{ path: '*', element: <h1>Docs</h1> }] },
      {
        path: '/:locale/docs/*',
        element: <PublicLayout />,
        children: [{ path: '*', element: <h1>Docs</h1> }],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return router;
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  headerProps.current = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PublicLayout', () => {
  it('composes the shared header, minimal footer, and a skip link to the main column', () => {
    renderPath('/docs/getting-started');

    expect(screen.getByRole('heading', { name: 'Docs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#public-main',
    );
    expect(document.getElementById('public-main')).toContainElement(
      screen.getByRole('heading', { name: 'Docs' }),
    );
    expect(document.querySelector('footer')).toBeInTheDocument();
    expect(headerProps.current).toMatchObject({
      variant: 'marketing',
      homeHref: '/',
      links: [{ to: '/docs', labelKey: 'nav.docs' }],
      loginHref: '/login',
      ctaHref: '/register',
    });
  });

  it('keeps the locale on every header destination', () => {
    renderPath('/ar/docs');

    expect(headerProps.current).toMatchObject({
      homeHref: '/ar',
      links: [{ to: '/ar/docs', labelKey: 'nav.docs' }],
      loginHref: '/login?lng=ar',
      ctaHref: '/register?lng=ar',
    });
  });

  it('moves to the same page in the chosen locale', async () => {
    const router = renderPath('/docs/getting-started');

    await userEvent.click(screen.getByRole('button', { name: 'switch locale' }));

    expect(router.state.location.pathname).toBe('/fr/docs/getting-started');
  });

  it('decodes a valid fragment and scrolls its target into view', async () => {
    const target = document.createElement('div');
    target.id = 'install steps';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);

    renderPath('/docs/self-hosting#install%20steps');

    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
    target.remove();
  });

  it('scrolls to the top when there is no fragment', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    renderPath('/docs');

    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0 }));
  });

  it('leaves a malformed percent-encoded fragment inert', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    renderPath('/docs#%');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
