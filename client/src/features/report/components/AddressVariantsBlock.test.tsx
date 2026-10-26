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
