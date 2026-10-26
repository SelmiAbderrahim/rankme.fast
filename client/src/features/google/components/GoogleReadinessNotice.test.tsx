import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { GoogleReadinessNotice } from './GoogleReadinessNotice';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

function renderNotice(status: 'ok' | 'not_connected' | 'no_property' | 'property_mismatch' | 'error', matching = false, showAction = true) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <GoogleReadinessNotice siteId="site one" domain="example.com" product="gsc" readiness={{ status, matching }} showAction={showAction} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('site Google readiness', () => {
  it('hides the notice for usable data or unavailable readiness', () => {
    renderNotice('ok');
    expect(screen.queryByTestId('google-readiness-gsc')).not.toBeInTheDocument();
  });

  it('uses the Analytics wording for an Analytics property', () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter>
      <GoogleReadinessNotice siteId="site-1" domain="example.com" product="ga4"
        readiness={{ status: 'no_property', matching: false }} />
    </MemoryRouter></I18nextProvider>);
    expect(screen.getByText('Choose a Google Analytics property')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Select a Google Analytics property' })).toBeInTheDocument();
  });

  it('explains a missing property and offers the site-scoped next step', () => {
    renderNotice('no_property', true);
    expect(screen.getByText('Choose a Search Console property')).toBeInTheDocument();
    expect(screen.getByText(/looking for a matching property/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Select a Search Console property' })).toHaveAttribute('href', '/sites/site%20one?tab=google');
    expect(screen.getByText('example.com')).toHaveAttribute('dir', 'auto');
  });

  it('shows distinct mismatch and permission failures without an action on the Google tab', () => {
    const view = renderNotice('property_mismatch', false, false);
    expect(screen.getByText("This property doesn't cover the site")).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    view.rerender(<I18nextProvider i18n={i18n}><MemoryRouter><GoogleReadinessNotice siteId="site one" domain="example.com" product="gsc" readiness={{ status: 'error', matching: false }} /></MemoryRouter></I18nextProvider>);
    expect(screen.getByText("Search Console can't be read right now")).toBeInTheDocument();
  });
});
