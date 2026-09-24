import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { LayoutDashboard } from 'lucide-react';
import { APP_PAGE_ICONS, SIDEBAR_ICON_KEYS } from '@shared/navigation/appPageIcons';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('keeps the icon decorative and exposes the localized title as the h1 name', () => {
    render(
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        titleId="dashboard-title"
        description="Your account overview"
        supportingContent={<a href="/docs">Open guide</a>}
        actions={<button type="button">Refresh</button>}
        aria-label="Page identity"
      />,
    );

    expect(screen.getByRole('banner', { name: 'Page identity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveAttribute(
      'id',
      'dashboard-title',
    );
    expect(screen.getByText('Your account overview')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open guide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="page-header-icon"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
  });

  it('supports page-specific heading attributes and omits optional regions', () => {
    const titleRef = createRef<HTMLHeadingElement>();
    render(
      <PageHeader
        icon={LayoutDashboard}
        title="Guide"
        titleRef={titleRef}
        className="page-class"
        titleProps={{ className: 'font-serif', tabIndex: -1 }}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Guide' });
    expect(heading).toHaveClass('font-serif');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(titleRef.current).toBe(heading);
    expect(heading.closest('header')).toHaveClass('page-class');
    expect(heading.parentElement).toHaveTextContent('Guide');
  });
});

describe('app page icon registry', () => {
  it('assigns a distinct icon component to every sidebar destination', () => {
    const icons = SIDEBAR_ICON_KEYS.map((key) => APP_PAGE_ICONS[key]);
    expect(new Set(icons).size).toBe(SIDEBAR_ICON_KEYS.length);
  });

  it('keeps first-level child-page icons distinct from every parent destination', () => {
    const icons = Object.values(APP_PAGE_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
