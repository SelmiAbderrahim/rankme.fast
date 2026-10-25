import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { DeleteAccountLink } from './DeleteAccountLink';

it('sends account deletion to the one Security settings flow', () => {
  initI18n({ initialLocale: 'en' });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><DeleteAccountLink /></MemoryRouter></I18nextProvider>);
  expect(screen.getByRole('link', { name: 'Go to Security settings' }))
    .toHaveAttribute('href', '/settings/security');
});
