import { useRoutePattern } from '@shared/feedback/useRoutePattern';
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
 * guest/auth screens use MinimalLayout instead.
 */
export const AppLayout = () => {
  const routePattern = useRoutePattern();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 max-w-full">
        <ReleaseStageBanner routePattern={routePattern} />
        <AppTopbar />
        <main className="min-w-0 max-w-full flex-1 px-4 py-6">
          <AppBreadcrumbs />
          <WorkspaceRouteGuard>
            <Outlet />
          </WorkspaceRouteGuard>
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  );
};
