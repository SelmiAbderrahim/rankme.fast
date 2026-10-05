import { useRoutePattern } from '@shared/feedback/useRoutePattern';
import { useAppDocumentTitle } from '@shared/hooks/useAppDocumentTitle';
import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarInset, SidebarProvider } from '@shared/ui/sidebar';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { WorkspaceRouteGuard } from '@features/workspace';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';
import { Footer } from './Footer';
import { ReleaseStageBanner } from './ReleaseStageBanner';

/**
 * Authenticated app shell (SPEC-01) — fixed sidebar + framed main column
 * (topbar, content, in-frame footer). One shell for every authed surface;
 * guest/auth screens use MinimalLayout instead. `children` replaces the
 * `<Outlet />` for the rare page that is not a child route of the shell (the
 * signed-in 404, which is matched by the public catch-all).
 */
export const AppLayout = ({ children }: { children?: ReactNode }) => {
  const routePattern = useRoutePattern();
  useAppDocumentTitle();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 max-w-full">
        <ReleaseStageBanner routePattern={routePattern} />
        <AppTopbar />
        <main className="min-w-0 max-w-full flex-1 px-4 py-6">
          <AppBreadcrumbs />
          <WorkspaceRouteGuard>
            {children ?? <Outlet />}
          </WorkspaceRouteGuard>
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  );
};
