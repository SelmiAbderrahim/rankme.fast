import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { ReleaseStageBanner, releaseBannerStorageKey } from './ReleaseStageBanner';

const renderBanner = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <main>
        <ReleaseStageBanner />
      </main>
    </I18nextProvider>,
  );

describe('ReleaseStageBanner', () => {
  beforeEach(() => {
    initI18n({ initialLocale: 'en' });
    localStorage.clear();
    vi.stubEnv('VITE_RELEASE_STAGE', 'beta');
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.com/rankmefast/rankmefast');
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllEnvs();
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('announces beta, opens external report links safely, and moves focus after keyboard dismissal', async () => {
    renderBanner();
    const banner = screen.getByRole('region', { name: /release status/i });
    expect(banner).toBeVisible();
    const reportBug = screen.getByRole('button', { name: /report a bug/i });
    expect(reportBug).toBeVisible();
    const progress = screen.getByRole('link', { name: /follow progress/i });
    expect(progress).toHaveAttribute('target', '_blank');
    expect(progress).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const user = userEvent.setup();
    screen.getByRole('button', { name: /hide.*beta/i }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('region', { name: /release status/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(releaseBannerStorageKey())).toBe('1');
    expect(document.querySelector('main')).toHaveFocus();
  });

  it('keeps a dismissal for the current release stage after remounting', async () => {
    const view = renderBanner();
    await userEvent.setup().click(screen.getByRole('button', { name: /hide.*beta/i }));
    view.unmount();
    renderBanner();
    expect(screen.queryByTestId('release-stage-banner')).not.toBeInTheDocument();
  });

  it('keeps the email fallback in the current tab when no public repository is configured', async () => {
    vi.stubEnv('VITE_GITHUB_URL', undefined as unknown as string);
    renderBanner();

    await userEvent.setup().click(screen.getByRole('button', { name: /report a bug/i }));
    const destination = screen.getByRole('dialog').querySelector('a');
    expect(destination).toHaveAttribute('href', 'mailto:support@rankme.fast');
    expect(destination).not.toHaveAttribute('target');
    expect(destination).not.toHaveAttribute('rel');
  });

  it('opens a report dialog before offering the configured issue chooser', async () => {
    renderBanner();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /report a bug/i }));
    const dialog = screen.getByRole('dialog', { name: /report a bug/i });
    expect(dialog).toHaveTextContent('Choose where to report the bug');
    expect(dialog.querySelector('a')).toHaveAttribute(
      'href',
      'https://github.com/rankmefast/rankmefast/issues/new/choose',
    );
  });

  it('includes the declared route in the support email without exposing a page URL', async () => {
    vi.stubEnv('VITE_GITHUB_URL', undefined as unknown as string);
    render(
      <I18nextProvider i18n={i18n}>
        <ReleaseStageBanner routePattern="/sites/:siteId" />
      </I18nextProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /report a bug/i }));
    const href = screen.getByRole('dialog').querySelector('a')?.getAttribute('href');
    expect(href).toContain('mailto:support@rankme.fast?');
    expect(decodeURIComponent(href!)).toContain('route: /sites/:siteId');
    expect(decodeURIComponent(href!)).toContain('edition: self-hosted');
  });

  it('dismisses safely without a main landmark and preserves an existing main tabindex', async () => {
    const user = userEvent.setup();
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ReleaseStageBanner />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole('button', { name: /hide.*beta/i }));
    expect(screen.queryByTestId('release-stage-banner')).not.toBeInTheDocument();

    localStorage.clear();
    view.unmount();
    render(
      <I18nextProvider i18n={i18n}>
        <main tabIndex={-1}>
          <ReleaseStageBanner />
        </main>
      </I18nextProvider>,
    );
    await user.click(screen.getByRole('button', { name: /hide.*beta/i }));
    expect(document.querySelector('main')).toHaveAttribute('tabindex', '-1');
    expect(document.querySelector('main')).toHaveFocus();
  });

  it('remains usable when browser storage rejects reads or writes', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderBanner();
    await userEvent.setup().click(screen.getByRole('button', { name: /hide.*beta/i }));
    expect(screen.queryByTestId('release-stage-banner')).not.toBeInTheDocument();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('server-renders before browser dismissal state and uses Arabic copy in RTL', async () => {
    const html = renderToString(
      <I18nextProvider i18n={i18n}>
        <ReleaseStageBanner />
      </I18nextProvider>,
    );
    expect(html).toContain('release-stage-banner');
    await i18n.changeLanguage('ar');
    renderBanner();
    expect(screen.getByRole('region')).toHaveTextContent('نسخة تجريبية عامة');
  });

  it('does not render after the release is generally available', () => {
    vi.stubEnv('VITE_RELEASE_STAGE', 'ga');
    renderBanner();
    expect(screen.queryByTestId('release-stage-banner')).not.toBeInTheDocument();
  });
});
