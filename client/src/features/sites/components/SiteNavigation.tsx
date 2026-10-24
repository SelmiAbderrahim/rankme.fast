import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSiteNavigation } from './siteNav/context';
import { SiteMenu } from './siteNav/SiteMenu';
import { SiteMobileBar } from './siteNav/SiteMobileBar';
import { activeTabFromLocation } from './siteNav/shared';

export {
  SITE_SIDEBAR_OVERLAY_QUERY,
  SiteNavigationProvider,
  useSiteNavigation,
  type SiteNavigationContextValue,
} from './siteNav/context';
export { SiteFavicon, SiteSwitcher } from './siteNav/SiteSwitcher';

interface SiteNavigationFrameProps {
  children: ReactNode;
  /** The shell's footer: it closes the content column, never the site sidebar. */
  footer?: ReactNode;
}

/**
 * Site routes put the site sidebar beside the content column. From `md` up
 * the sidebar sticks under the topbar at the column's full height while the
 * page scrolls; the footer ends the content column only. Phones get the site
 * bar and the "Choose a page" sheet instead.
 */
export const SiteNavigationFrame = ({ children, footer = null }: SiteNavigationFrameProps) => {
  const { isSiteRoute, siteMenuOverlay } = useSiteNavigation();
  const { pathname, search } = useLocation();
  if (!isSiteRoute) {
    return (
      <>
        {children}
        {footer}
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SiteMobileBar />
      <div className="flex min-w-0 flex-1">
        <div
          data-site-menu="desktop"
          className={
            siteMenuOverlay
              ? 'sticky top-14 z-30 hidden h-[calc(100dvh-4.5rem)] w-(--site-sidebar-width-icon) shrink-0 self-start md:block'
              : 'sticky top-14 z-30 hidden h-[calc(100dvh-4.5rem)] shrink-0 self-start md:block'
          }
        >
          <SiteMenu />
        </div>
        <div className="flex min-w-0 flex-1 flex-col md:min-h-[calc(100dvh-4.5rem)]">
          {children}
          {footer}
        </div>
      </div>
      <span className="sr-only" data-site-active-tab={activeTabFromLocation(pathname, search)} />
    </div>
  );
};
