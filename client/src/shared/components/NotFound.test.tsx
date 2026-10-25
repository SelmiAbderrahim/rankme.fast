import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { NotFound } from './NotFound';

describe('NotFound', () => {
  it('shows the not-found message and asks search engines not to index it', async () => {
    initI18n({ initialLocale: 'en' });
    render(
      <HelmetProvider>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <NotFound />
          </MemoryRouter>
        </I18nextProvider>
      </HelmetProvider>,
    );
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow'),
    );
  });
});
