import { useRoutePattern } from '@shared/feedback/useRoutePattern';
import { AppTitleBoundary } from './AppTitleBoundary';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { useShellScrollRestoration } from '@shared/hooks/useShellScrollRestoration';
import { returnFocusTo, useOverlayDismiss } from '@shared/hooks/useOverlayDismiss';
import { Outlet, useLocation } from 'react-router-dom';
import {
  SidebarInset,
  SidebarProvider,
  readSidebarCookie,
  writeSidebarCookie,
} from '@shared/ui/sidebar';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { SiteNavigationFrame, SiteNavigationProvider } from '@features/sites';
import { WorkspaceRouteGuard } from '@features/workspace';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';
import { Footer } from './Footer';
import { ReleaseStageBanner } from './ReleaseStageBanner';
import { SkipLink } from './SkipLink';

const SIDEBAR_COLLAPSE_QUERY = '(max-width: 1279.98px)';
const SIDEBAR_OVERLAY_QUERY = '(min-width: 768px) and (max-width: 1023.98px)';

/** Inline choices persist; tablet expansions are temporary overlays. */
const useAppSidebarState = () => {
  const narrow = useMediaQuery(SIDEBAR_COLLAPSE_QUERY);
  const overlay = useMediaQuery(SIDEBAR_OVERLAY_QUERY);
  const { pathname, search } = useLocation();
  const [saved, setSaved] = useState<boolean | null>(() => readSidebarCookie());
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => setOverlayOpen(false), [overlay, pathname, search]);
  const open = overlay ? overlayOpen : (saved ?? !narrow);
  const setOpen = useCallback(
    (next: boolean) => {
      if (overlay) {
        setOverlayOpen(next);
        return;
      }
      setSaved(next);
      writeSidebarCookie(next);
    },
    [overlay],
  );
  useOverlayDismiss(
    overlay && overlayOpen,
    () => document.querySelector('[data-slot="sidebar-container"]'),
    () => {
      setOverlayOpen(false);
      returnFocusTo(() =>
        document.querySelector<HTMLElement>('[data-testid="app-sidebar-toggle"]'),
      );
    },
    () => [document.querySelector<HTMLElement>('[data-testid="app-sidebar-toggle"]')],
  );
  return { open, setOpen, overlay };
};

/**
 * Authenticated app shell (SPEC-01) — fixed sidebar + framed main column
 * (topbar, content, in-frame footer). Desktop content scrolls within one
 * viewport; phones retain document scrolling. One shell for every authed surface;
 * guest/auth screens use MinimalLayout instead. `children` replaces the
 * `<Outlet />` for the rare page that is not a child route of the shell (the
 * signed-in 404, which is matched by the public catch-all).
 */
export const AppLayout = ({ children }: { children?: ReactNode }) => {
  const routePattern = useRoutePattern();
  const mainRef = useRef<HTMLElement>(null);
  useShellScrollRestoration(() => mainRef.current!.closest('[data-slot="sidebar-inset"]'));
  const sidebar = useAppSidebarState();
  return (
    <AppTitleBoundary>
      <SidebarProvider
        className="md:h-dvh md:overflow-hidden"
        data-app-frame=""
        open={sidebar.open}
        onOpenChange={sidebar.setOpen}
        overlay={sidebar.overlay}
      >
        <SkipLink targetId="main-content" />
        <AppSidebar />
        <SiteNavigationProvider>
          <SidebarInset className="min-w-0 max-w-full md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-none md:*:shrink-0 md:scroll-pt-18">
            <ReleaseStageBanner routePattern={routePattern} />
            <AppTopbar />
            <SiteNavigationFrame footer={<Footer />}>
              <main
                id="main-content"
                ref={mainRef}
                tabIndex={-1}
                className="min-w-0 max-w-full flex-1 px-4 py-6 focus:outline-none"
              >
                <AppBreadcrumbs />
                <WorkspaceRouteGuard>{children ?? <Outlet />}</WorkspaceRouteGuard>
              </main>
            </SiteNavigationFrame>
          </SidebarInset>
        </SiteNavigationProvider>
      </SidebarProvider>
    </AppTitleBoundary>
  );
};
