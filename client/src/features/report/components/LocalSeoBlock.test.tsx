import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { LocalSeoBlock } from './LocalSeoBlock';
import type { LocalSeoSection } from '../types';

const wrap = (ui: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );

/** Fully-populated ok section; override individual fields per test. */
const okSection = (overrides: Partial<LocalSeoSection> = {}): LocalSeoSection => ({
  status: 'ok',
  listings: [
    { source: 'Google Business', consistent: true },
    { source: 'Yelp', consistent: false },
  ],
  reviews: { averageRating: 4.5, reviewCount: 123 },
  qa: { unansweredCount: 2 },
  localPack: { keyword: 'plumbers near me', position: 2, totalPackSize: 3 },
  ...overrides,
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

afterEach(() => {
  // nothing async to clean up — here for symmetry with sibling tests
});

describe('LocalSeoBlock', () => {
  // -----------------------------------------------------------------------
  // Unavailable / not-configured guard clauses
  // -----------------------------------------------------------------------

  it('renders the unavailable note when section is null', () => {
    wrap(<LocalSeoBlock section={null} siteId="s-1" />);
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.unavailableTitle')),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('report-local-seo-block')).not.toBeInTheDocument();
  });

  it('renders the unavailable note when status is "unavailable"', () => {
    wrap(
      <LocalSeoBlock section={okSection({ status: 'unavailable' })} siteId="s-1" />,
    );
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.unavailableTitle')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.unavailableBody')),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('report-local-seo-block')).not.toBeInTheDocument();
  });

  it('renders the not-configured note with a link when status is "not-configured"', () => {
    wrap(
      <LocalSeoBlock section={okSection({ status: 'not-configured' })} siteId="s-1" />,
    );
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.notConfiguredTitle')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.notConfiguredBody')),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: i18n.t('report:localSeoBlock.notConfiguredCta'),
    });
    expect(link).toHaveAttribute('href', '/sites/s-1?tab=local-seo');
    expect(screen.queryByTestId('report-local-seo-block')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Full ok block
  // -----------------------------------------------------------------------

  it('renders the full ok block: listings (both badge states), reviews, qa, localPack', () => {
    wrap(<LocalSeoBlock section={okSection()} siteId="s-1" />);
    expect(screen.getByTestId('report-local-seo-block')).toBeInTheDocument();

    // listings
    expect(screen.getByText('Google Business')).toBeInTheDocument();
    expect(screen.getByText('Yelp')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.consistent')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.inconsistent')),
    ).toBeInTheDocument();

    // reviews
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();

    // qa
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.unansweredQuestions')),
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    // localPack with numeric position
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.localPack')),
    ).toBeInTheDocument();
    expect(screen.getByText('plumbers near me')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders null averageRating as the noData label', () => {
    wrap(
      <LocalSeoBlock
        section={okSection({ reviews: { averageRating: null, reviewCount: 5 } })}
        siteId="s-1"
      />,
    );
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.noData')),
    ).toBeInTheDocument();
  });

  it('renders null localPack.position as the notRanked label', () => {
    wrap(
      <LocalSeoBlock
        section={okSection({
          localPack: { keyword: 'test kw', position: null, totalPackSize: 3 },
        })}
        siteId="s-1"
      />,
    );
    expect(
      screen.getByText(i18n.t('report:localSeoBlock.notRanked')),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Optional-section null guards (falsy branches in the JSX)
  // -----------------------------------------------------------------------

  it('hides the listings section when listings is empty', () => {
    wrap(<LocalSeoBlock section={okSection({ listings: [] })} siteId="s-1" />);
    expect(screen.queryByText('Google Business')).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('report:localSeoBlock.listings')),
    ).not.toBeInTheDocument();
  });

  it('hides the reviews section when reviews is null', () => {
    wrap(<LocalSeoBlock section={okSection({ reviews: null })} siteId="s-1" />);
    expect(
      screen.queryByText(i18n.t('report:localSeoBlock.averageRating')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('report:localSeoBlock.reviewCount')),
    ).not.toBeInTheDocument();
  });

  it('hides the unanswered-questions row when qa is null', () => {
    wrap(<LocalSeoBlock section={okSection({ qa: null })} siteId="s-1" />);
    expect(
      screen.queryByText(i18n.t('report:localSeoBlock.unansweredQuestions')),
    ).not.toBeInTheDocument();
  });

  it('hides the localPack section when localPack is null', () => {
    wrap(<LocalSeoBlock section={okSection({ localPack: null })} siteId="s-1" />);
    expect(
      screen.queryByText(i18n.t('report:localSeoBlock.localPack')),
    ).not.toBeInTheDocument();
  });
});
