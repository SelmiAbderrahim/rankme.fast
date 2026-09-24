import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@shared/ui/tooltip';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { i18n, initI18n } from '@shared/i18n';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { Header, type HeaderProps } from './Header';

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

const mockSession = (authenticated: boolean) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated,
    isPending: false,
    emailVerified: authenticated,
    user: null,
  } satisfies AuthSessionState);
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderHeader = (
  authenticated: boolean,
  variant: 'app' | 'marketing' = 'app',
  props: Omit<HeaderProps, 'variant'> = {},
) => {
  mockSession(authenticated);
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <TooltipProvider>
          <MemoryRouter>
            <Header variant={variant} {...props} />
          </MemoryRouter>
        </TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
};

describe('Header desktop nav', () => {
  it('renders every authenticated product surface link', () => {
    renderHeader(true);
    for (const name of [
      'Dashboard',
      'Sites',
      'Keyword research',
      'Notifications',
      'Logout',
    ]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('renders anonymous links when signed out', () => {
    renderHeader(false);
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument();
  });

  it('no longer links the removed public Guides from the app header', () => {
    renderHeader(true);
    expect(screen.queryByRole('link', { name: 'Guides' })).not.toBeInTheDocument();
  });
});

describe('Header mobile menu', () => {
  it('shows the named public-beta badge in desktop chrome and in the mobile sheet only during beta', async () => {
    vi.stubEnv('VITE_RELEASE_STAGE', 'beta');
    const user = userEvent.setup();
    renderHeader(false, 'marketing');

    expect(screen.getByText(/RankMeFast, public beta/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/RankMeFast, public beta/i)).toBeInTheDocument();
  });

  it('removes both desktop and mobile beta badges after general availability', async () => {
    vi.stubEnv('VITE_RELEASE_STAGE', 'ga');
    const user = userEvent.setup();
    renderHeader(false, 'marketing');

    expect(screen.queryByTestId('release-stage-badge')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    expect(
      (await screen.findByRole('dialog')).querySelector('[data-testid="release-stage-badge"]'),
    ).toBeNull();
  });

  it('opens a sheet exposing the same authed nav links', async () => {
    const user = userEvent.setup();
    renderHeader(true);
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    for (const name of [
      'Dashboard',
      'Sites',
      'Keyword research',
      'Notifications',
      'Logout',
    ]) {
      expect(within(dialog).getByRole('link', { name })).toBeInTheDocument();
    }
    // Clicking a link closes the sheet.
    await user.click(within(dialog).getByRole('link', { name: 'Dashboard' }));
  });

  it('opens the mobile sheet from the left edge in RTL locales', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('ar');
    renderHeader(false);
    await user.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    expect(await screen.findByRole('dialog')).toHaveClass('left-0');
    await i18n.changeLanguage('en');
  });

  it('shows anonymous links in the mobile sheet', async () => {
    const user = userEvent.setup();
    renderHeader(false);
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Login' })).toBeInTheDocument();
  });
});

describe('Header marketing variant', () => {
  it('forwards the configured CTA variant and destination', () => {
    renderHeader(false, 'marketing', {
      ctaHref: '/register',
      ctaLabelKey: 'nav.startFree',
      ctaVariant: 'outline',
    });

    const cta = screen.getByRole('link', { name: 'Start free' });
    expect(cta).toHaveAttribute('data-variant', 'outline');
    expect(cta).toHaveAttribute('href', '/register');
  });

  it('renders the GitHub chip in the desktop actions and mobile sheet when configured', async () => {
    const user = userEvent.setup();
    renderHeader(false, 'marketing', {
      githubHref: 'https://github.com/rankmefast/rankmefast',
    });

    const desktopChip = screen.getByRole('link', { name: /GitHub/ });
    expect(desktopChip).toHaveAttribute('href', 'https://github.com/rankmefast/rankmefast');
    expect(desktopChip).toHaveAttribute('target', '_blank');
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/rankmefast/rankmefast',
    );
  });

  it('renders no GitHub chip when no repository URL is configured', () => {
    renderHeader(false, 'marketing');
    expect(screen.queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
  });

  it('shows the authed dashboard + log out CTAs and closes the sheet on click', async () => {
    const user = userEvent.setup();
    renderHeader(true, 'marketing');
    // Desktop CTA pair is present for an authenticated visitor.
    expect(screen.getAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    // Exercise both authed CTAs' close-on-click handlers.
    await user.click(within(dialog).getAllByRole('link', { name: 'Dashboard' })[0]!);
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog1b = await screen.findByRole('dialog');
    await user.click(within(dialog1b).getByRole('link', { name: /log out/i }));
  });

  it('shows the anon log in + get started CTAs and closes the sheet on click', async () => {
    const user = userEvent.setup();
    renderHeader(false, 'marketing');
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('link', { name: /log in/i }));
    // Re-open and exercise the primary CTA path too.
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    const dialog2 = await screen.findByRole('dialog');
    await user.click(within(dialog2).getAllByRole('link', { name: /register/i })[0]!);
  });
});
