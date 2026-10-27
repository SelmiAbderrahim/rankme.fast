import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AddressVariantsBlock } from './AddressVariantsBlock';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('failed address checks (issue #59)', () => {
  it('offers no retry when every address answered conclusively, including a site error', () => {
    render(<I18nextProvider i18n={i18n}><AddressVariantsBlock variants={[
      { url: 'https://example.com/', status: 200, finalUrl: 'https://example.com/', ok: true },
      { url: 'http://www.example.com/', status: 404, finalUrl: 'http://www.example.com/', ok: false },
    ]} /></I18nextProvider>);
    expect(screen.getByText('Your main address')).toBeInTheDocument();
    expect(screen.getByText('Needs fixing')).toBeInTheDocument();
    expect(screen.queryByTestId('report-address-retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Check failed')).not.toBeInTheDocument();
  });

  it.each([
    ['tls', 'TLS certificate validation failed'],
    ['dns', 'DNS lookup failed'],
    ['timeout', 'Request timed out'],
    ['unreachable', 'Could not connect'],
  ] as const)('explains %s errors and how to retry', (reason, message) => {
    render(<I18nextProvider i18n={i18n}><AddressVariantsBlock variants={[{
      url: 'https://www.example.com/', status: null, finalUrl: null, ok: null, failure: { reason },
    }]} /></I18nextProvider>);
    expect(screen.getByTestId('report-address-variant')).toHaveTextContent(message);
    expect(screen.getByText('Check failed')).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-address-retry')).toHaveTextContent('Run a new audit to retry failed checks.');
  });
});
