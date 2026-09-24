import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  MALICIOUS_COUNTRY_LABEL,
  MALICIOUS_DOMAIN,
  estimateObservation,
  maliciousTrafficDetail,
} from './__fixtures__/xss';
import { CoverageNote } from './components/CoverageNote';
import { SnapshotDetail } from './components/SnapshotDetail';

vi.mock('@features/report-export', () => ({
  ReportExportControl: () => <div data-testid="report-export-control" />,
}));

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  delete (window as unknown as { __trafficXss?: boolean }).__trafficXss;
});

describe('Traffic Insights output encoding', () => {
  it('renders malicious domain and country labels as inert React text nodes', () => {
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(MALICIOUS_COUNTRY_LABEL);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <SnapshotDetail detail={maliciousTrafficDetail} loading={false} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { name: MALICIOUS_DOMAIN })).toBeInTheDocument();
    expect(screen.getByText(MALICIOUS_COUNTRY_LABEL)).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    expect((window as unknown as { __trafficXss?: boolean }).__trafficXss).toBeUndefined();
  });

  it('guards optional external sources and applies the shared rel contract', () => {
    const unsafe = render(
      <I18nextProvider i18n={i18n}>
        <CoverageNote observation={estimateObservation} sourceHref="javascript:alert(1)" />
      </I18nextProvider>,
    );
    const unsafeLink = screen.getByRole('link', { name: 'Source' });
    expect(unsafeLink).toHaveAttribute('href', '#');
    expect(unsafeLink).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    unsafe.unmount();

    render(
      <I18nextProvider i18n={i18n}>
        <CoverageNote observation={estimateObservation} sourceHref="https://example.test/source" />
      </I18nextProvider>,
    );
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://example.test/source',
    );
  });
});
