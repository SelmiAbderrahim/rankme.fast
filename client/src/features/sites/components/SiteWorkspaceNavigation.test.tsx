import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { SiteTab } from '../tabState';
import { SiteWorkspaceNavigation } from './SiteWorkspaceNavigation';

const renderNavigation = (activeTab: SiteTab, onTabChange = vi.fn()) => {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <SiteWorkspaceNavigation
        activeTab={activeTab}
        onTabChange={onTabChange}
      />
    </I18nextProvider>,
  );
  return { onTabChange, ...view };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('SiteWorkspaceNavigation', () => {
  it('shows Overview directly and identifies the active desktop group and destination', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderNavigation('keywords');

    expect(screen.getByTestId('site-navigation')).toHaveAccessibleName('Workspace view');
    expect(screen.getByTestId('site-nav-desktop')).toHaveClass(
      'hidden',
      'md:grid',
      'grid-cols-3',
      '2xl:grid-cols-6',
    );
    expect(screen.getByTestId('site-nav-mobile').parentElement).toHaveClass('md:hidden');
    expect(screen.getByTestId('site-tab-overview')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('site-nav-group-search')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('site-nav-group-search')).toHaveAccessibleName('Search · Keywords');
    expect(screen.getByTestId('site-nav-group-content')).not.toHaveAttribute('data-active');
    await user.click(screen.getByTestId('site-tab-overview'));
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });

  it('marks the exact current menu destination and changes views from a group menu', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderNavigation('keywords');

    await user.click(screen.getByTestId('site-nav-group-search'));
    expect(screen.getByTestId('site-tab-keywords')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('site-tab-research')).not.toHaveAttribute('aria-current');
    await user.click(screen.getByTestId('site-tab-research'));
    expect(onTabChange).toHaveBeenCalledWith('research');
  });

  it('labels the active group and keeps every destination selectable', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderNavigation('backlinks');

    expect(screen.getByTestId('site-nav-group-visibility')).toHaveAccessibleName(
      'Visibility · Backlinks',
    );
    await user.click(screen.getByTestId('site-nav-group-visibility'));
    expect(screen.getByTestId('site-tab-backlinks')).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByTestId('site-tab-brand-radar'));
    expect(onTabChange).toHaveBeenCalledWith('brand-radar');
  });

  it('supports native keyboard navigation through each desktop menu', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderNavigation('overview');
    screen.getByTestId('site-nav-group-visibility').focus();

    await user.keyboard('{Enter}');
    await user.keyboard('{End}');
    expect(screen.getByTestId('site-tab-brand-radar')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onTabChange).toHaveBeenCalledWith('brand-radar');
  });

  it('uses a grouped mobile selector for all destinations', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderNavigation('overview');

    expect(screen.getByTestId('site-nav-mobile')).toHaveAccessibleName('Workspace view');
    expect(screen.getByTestId('site-tab-overview')).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByTestId('site-nav-mobile'));
    const options = within(screen.getByRole('listbox'));
    expect(options.getByText('Audit & reports')).toBeVisible();
    expect(options.getByText('Local & apps')).toBeVisible();
    await user.click(screen.getByTestId('site-nav-mobile-item-client-reports'));
    expect(onTabChange).toHaveBeenCalledWith('client-reports');
  });

  it('renders localized RTL navigation without changing the destination taxonomy', async () => {
    await changeLanguage('ar');
    renderNavigation('content');

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('site-navigation')).toHaveAccessibleName('عرض مساحة العمل');
    expect(screen.getByTestId('site-nav-group-content')).toHaveAccessibleName('المحتوى · المحتوى');
  });
});
