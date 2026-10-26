import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { googleReducer } from '../store/slice';
import { SiteGoogleNotice, SiteGoogleReadinessProvider, useSiteGoogleReadiness } from './SiteGoogleReadiness';
import type { SiteGoogleReadiness } from '../types';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const fromSite: SiteGoogleReadiness = {
  gsc: { status: 'no_property', matching: false },
  ga4: { status: 'ok', matching: false },
};

function renderProvider(google: ReturnType<typeof googleReducer>, readiness: SiteGoogleReadiness | undefined = fromSite) {
  const store = configureStore({ reducer: { google: googleReducer }, preloadedState: { google } });
  render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
    <SiteGoogleReadinessProvider siteId="site-1" domain="example.com" readiness={readiness}>
      <Probe />
      <SiteGoogleNotice product="gsc" />
    </SiteGoogleReadinessProvider>
  </MemoryRouter></I18nextProvider></Provider>);
}

function Probe() {
  const value = useSiteGoogleReadiness();
  return <span data-testid="resolved-readiness">{value?.readiness?.gsc.status ?? 'unknown'}</span>;
}

describe('site Google readiness context', () => {
  it('uses the site response until current configuration arrives', () => {
    renderProvider(googleReducer(undefined, { type: '@@init' }));
    expect(screen.getByTestId('resolved-readiness')).toHaveTextContent('no_property');
    expect(screen.getByText('Choose a Search Console property')).toBeInTheDocument();
  });

  it('uses a matching current configuration', () => {
    renderProvider({ ...googleReducer(undefined, { type: '@@init' }), loaded: true, connectionSiteId: 'site-1',
      connection: { status: 'connected', googleAccountEmail: 'owner@example.com', propertyUrl: null, connectedAt: '2026-10-01T00:00:00Z', lastUsedAt: null },
      readiness: { ...fromSite, gsc: { status: 'property_mismatch', matching: false } },
    });
    expect(screen.getByTestId('resolved-readiness')).toHaveTextContent('property_mismatch');
  });

  it('clears a stale site response after a disconnect', () => {
    renderProvider({ ...googleReducer(undefined, { type: '@@init' }), loaded: true, connectionSiteId: 'site-1' });
    expect(screen.getByTestId('resolved-readiness')).toHaveTextContent('not_connected');
  });

  it('keeps the site response when the current configuration carries no readiness yet', () => {
    renderProvider({ ...googleReducer(undefined, { type: '@@init' }), loaded: true, connectionSiteId: 'site-1',
      connection: { status: 'connected', googleAccountEmail: 'owner@example.com', propertyUrl: null, connectedAt: '2026-10-01T00:00:00Z', lastUsedAt: null },
      readiness: null,
    });
    expect(screen.getByTestId('resolved-readiness')).toHaveTextContent('no_property');
  });

  it('renders no notice outside a provider', () => {
    const { container } = render(<SiteGoogleNotice product="gsc" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no value outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('resolved-readiness')).toHaveTextContent('unknown');
  });

  it('hides a not-connected notice that has no action, and keeps one that is actionable', () => {
    const store = configureStore({ reducer: { google: googleReducer } });
    const notConnected: SiteGoogleReadiness = {
      gsc: { status: 'not_connected', matching: false },
      ga4: { status: 'not_connected', matching: false },
    };
    const { container, rerender } = render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <SiteGoogleReadinessProvider siteId="site-1" domain="example.com" readiness={notConnected}>
        <SiteGoogleNotice product="gsc" showAction={false} />
      </SiteGoogleReadinessProvider>
    </MemoryRouter></I18nextProvider></Provider>);
    expect(container).toBeEmptyDOMElement();
    rerender(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <SiteGoogleReadinessProvider siteId="site-1" domain="example.com" readiness={fromSite}>
        <SiteGoogleNotice product="gsc" showAction={false} />
      </SiteGoogleReadinessProvider>
    </MemoryRouter></I18nextProvider></Provider>);
    expect(container).not.toBeEmptyDOMElement();
  });
});
