import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ComparisonBadge, urlComparisonStatus } from './ComparisonBadge';
import { OlderRunBanner } from './OlderRunBanner';
import { ScopeMismatchNote } from './ScopeMismatchNote';
import type { ReportComparison } from '../types';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const wrap = (node: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  );

describe('ComparisonBadge', () => {
  it.each(['new', 'regressed', 'improved', 'resolved', 'not_comparable'] as const)('labels %s', (status) => {
    wrap(<ComparisonBadge status={status} />);
    expect(screen.getByTestId(`report-comparison-${status}`)).toHaveAttribute('data-status', status);
  });

  it('renders nothing for unchanged or unknown', () => {
    const { container, rerender } = wrap(<ComparisonBadge status="unchanged" />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <I18nextProvider i18n={i18n}>
        <ComparisonBadge status={undefined} />
      </I18nextProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('maps a per-URL diff kind onto the same vocabulary', () => {
    expect(urlComparisonStatus('fixed')).toBe('resolved');
    expect(urlComparisonStatus('regressed')).toBe('regressed');
    expect(urlComparisonStatus('new')).toBe('new');
    expect(urlComparisonStatus('unchanged')).toBeUndefined();
    expect(urlComparisonStatus(undefined)).toBeUndefined();
  });
});

describe('ScopeMismatchNote', () => {
  const comparison = (over: Partial<ReportComparison['previous']> = {}): ReportComparison => ({
    previousRunId: 'r0',
    previous: { pageCap: 100, pagesCrawled: 100, ...over },
    current: { pageCap: 5000, pagesCrawled: 1280 },
    scopeMismatch: true,
  });

  it('compares crawled page counts when both are recorded', () => {
    wrap(<ScopeMismatchNote comparison={comparison()} />);
    expect(screen.getByTestId('report-scope-mismatch')).toHaveTextContent('100 pages');
    expect(screen.getByTestId('report-scope-mismatch')).toHaveTextContent('1,280');
  });

  it('falls back to the page limits when a count is missing', () => {
    wrap(<ScopeMismatchNote comparison={comparison({ pagesCrawled: null })} />);
    expect(screen.getByTestId('report-scope-mismatch')).toHaveTextContent('page limit of 100');
  });
});

describe('OlderRunBanner', () => {
  it('names the date and links back to the latest report', () => {
    wrap(<OlderRunBanner siteId="site-1" runAt="2026-08-20T19:42:00.000Z" />);
    expect(screen.getByTestId('report-older-run')).toHaveTextContent('Aug 20, 2026');
    expect(screen.getByTestId('report-older-run-latest')).toHaveAttribute('href', '/sites/site-1?tab=report');
  });

  it('says so when the run has no date', () => {
    wrap(<OlderRunBanner siteId="site-1" runAt={null} />);
    expect(screen.getByTestId('report-older-run')).toHaveTextContent('older audit');
  });
});
