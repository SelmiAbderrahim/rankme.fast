import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n, type SupportedLocale } from '@shared/i18n';
import { StaleAuditCallout, type StaleAuditCalloutProps } from './StaleAuditCallout';
import { SiteLifecycleProvider } from '@shared/site/capabilities';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY - 1_000).toISOString();

const renderCallout = (props: Partial<StaleAuditCalloutProps> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StaleAuditCallout
          runAt={ago(45)}
          running={false}
          freshDays={30}
          now={NOW}
          to="?tab=report&retest=1"
          {...(props as object)}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('StaleAuditCallout', () => {
  it('shows the age of a stale audit and links to the confirmation', () => {
    renderCallout();
    expect(screen.getByTestId('stale-audit-title')).toHaveTextContent('Last audited 45 days ago');
    expect(screen.getByRole('region', { name: /last audited 45 days ago/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run a new audit' })).toHaveAttribute(
      'href',
      '/?tab=report&retest=1',
    );
  });

  it('only informs when the page already offers the action', () => {
    renderCallout({ to: undefined });
    expect(screen.getByTestId('stale-audit-title')).toHaveTextContent('Last audited 45 days ago');
    expect(screen.getByText('Results may no longer match your site. Run a new audit to refresh them.')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-audit-run')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run a new audit' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('follows the current clock: the same audit reads older later', () => {
    const { unmount } = renderCallout({ runAt: ago(40), now: NOW });
    expect(screen.getByTestId('stale-audit-title')).toHaveTextContent('40 days');
    unmount();
    renderCallout({ runAt: ago(40), now: NOW + 7 * DAY });
    expect(screen.getByTestId('stale-audit-title')).toHaveTextContent('47 days');
  });

  it.each([
    ['a fresh audit', { runAt: ago(5) }],
    ['a site never audited', { runAt: null }],
    ['an audit that is running now', { runAt: ago(90), running: true }],
    ['a report with no freshness threshold', { runAt: ago(90), freshDays: undefined }],
  ])('renders nothing for %s', (_label, props) => {
    renderCallout(props);
    expect(screen.queryByTestId('stale-audit-callout')).toBeNull();
  });

  it.each([
    ['en', 31, 'Last audited 31 days ago'],
    ['fr', 31, 'Dernier audit il y a 31 jours'],
    ['de', 31, 'Letztes Audit vor 31 Tagen'],
    ['es', 31, 'Última auditoría hace 31 días'],
    ['ru', 31, 'Последний аудит был 31 день назад'],
    ['ru', 32, 'Последний аудит был 32 дня назад'],
    ['ru', 35, 'Последний аудит был 35 дней назад'],
    ['zh', 31, '上次审计是 31 天前'],
    ['ar', 32, 'آخر تدقيق قبل 32 يومًا'],
    ['ar', 33, 'آخر تدقيق قبل 33 يومًا'],
    ['ar', 40, 'آخر تدقيق قبل 40 يومًا'],
  ])('uses the right plural form in %s for %i days', async (locale, days, expected) => {
    await changeLanguage(locale as SupportedLocale);
    renderCallout({ runAt: ago(days) });
    expect(screen.getByTestId('stale-audit-title')).toHaveTextContent(expected);
  });

  it('on a paused site says why instead of offering to run an audit', () => {
    const view = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SiteLifecycleProvider paused>
            <StaleAuditCallout runAt={ago(45)} running={false} freshDays={30} now={NOW} to="?tab=report&retest=1" />
          </SiteLifecycleProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );
    const button = screen.getByTestId('stale-audit-run');
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      'Resume this site to run checks, audits, or scheduled work.',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // Without its own action the reason lives under the page's disabled
    // action, so the callout does not repeat it.
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SiteLifecycleProvider paused>
            <StaleAuditCallout runAt={ago(45)} running={false} freshDays={30} now={NOW} />
          </SiteLifecycleProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('stale-audit-title')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-audit-run')).toBeNull();
    expect(screen.queryByText(/Resume this site/)).toBeNull();
    expect(screen.queryByText(/Results may no longer match/)).toBeNull();
  });
});

