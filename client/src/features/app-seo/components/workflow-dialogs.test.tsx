import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AppSeoViewShell } from './AppSeoViewShell';
import { AppListingRunDialog } from './listing/AppListingRunDialog';
import { ResearchSpendDialog } from './research/ResearchSpendDialog';
import { AppReviewRunDialog } from './reviews/AppReviewRunDialog';

const renderLocalized = (node: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('App SEO standalone view and spend dialogs', () => {
  it('renders a localized future-workspace shell', () => {
    renderLocalized(<AppSeoViewShell view="reviews" />);
    expect(screen.getByTestId('app-seo-view-reviews')).toHaveTextContent('Reviews');
  });

  it('covers listing preview loading, closing, and confirming', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const view = renderLocalized(
      <AppListingRunDialog open preview={null} busy onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText('Starting check…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Starting check…' })).toBeDisabled();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppListingRunDialog
            open
            preview={{ queued: false, runId: null, capturedAt: null, preview: {} }}
            busy={false}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('One run checks every store registered to this app profile.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Start listing check' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('covers research confirmations', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderLocalized(
      <ResearchSpendDialog open loading={false} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText('Confirm this lookup')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Run lookup' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('covers review-run defaults, closing, and confirmation', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const view = renderLocalized(
      <AppReviewRunDialog
        open
        preview={null}
        busy={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('Up to 300 reviews')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start review analysis' })).toBeDisabled();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewRunDialog
            open
            preview={{ queued: false, run: null, preview: {} }}
            busy={false}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Start review analysis' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
