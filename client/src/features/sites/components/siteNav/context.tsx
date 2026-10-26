import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthSession } from '@features/auth';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { returnFocusTo, useOverlayDismiss } from '@shared/hooks/useOverlayDismiss';
import { isPlainKey, isTypingTarget } from '@shared/lib/keyboard';
import {
  SITE_SIDEBAR_ID,
  readSiteSidebarCookie,
  rememberRecentSite,
  siteIdFromPath,
  writeSiteSidebarCookie,
} from './shared';

/** 768–1023px: both sidebars are rails; expanding one overlays the page. */
export const SITE_SIDEBAR_OVERLAY_QUERY = '(min-width: 768px) and (max-width: 1023.98px)';
const MOBILE_QUERY = '(max-width: 767.98px)';

export interface SiteNavigationContextValue {
  isSiteRoute: boolean;
  siteId: string | null;
  /** Expanded (240px) or a rail (56px). */
  siteMenuExpanded: boolean;
  /** Tablet: expanding overlays the page instead of pushing it. */
  siteMenuOverlay: boolean;
  /** `trigger` gets focus back when an overlay closes by Escape or an outside press. */
  setSiteMenuExpanded: (expanded: boolean, trigger?: HTMLElement) => void;
  toggleSiteMenu: (trigger?: HTMLElement) => void;
}

const SiteNavigationContext = createContext<SiteNavigationContextValue | null>(null);

export const useSiteNavigation = (): SiteNavigationContextValue => {
  const value = useContext(SiteNavigationContext);
  if (!value) throw new Error('useSiteNavigation must be used inside SiteNavigationProvider');
  return value;
};

export const SiteNavigationProvider = ({ children }: { children: ReactNode }) => {
  const { pathname, search } = useLocation();
  const { user } = useAuthSession();
  const siteId = siteIdFromPath(pathname);
  const overlay = useMediaQuery(SITE_SIDEBAR_OVERLAY_QUERY);
  // Read synchronously: the first paint already has the saved width.
  const [saved, setSaved] = useState<boolean>(() => readSiteSidebarCookie() ?? true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const expanded = overlay ? overlayOpen : saved;
  const userKey = user?.id ?? user?.email ?? 'anonymous';

  // The overlay never survives navigation or a width change.
  useEffect(() => setOverlayOpen(false), [overlay, pathname, search]);
  useEffect(() => {
    if (siteId) rememberRecentSite(userKey, siteId);
  }, [siteId, userKey]);

  const setSiteMenuExpanded = useCallback(
    (next: boolean, trigger?: HTMLElement) => {
      if (overlay) {
        if (next) returnFocus.current = trigger ?? null;
        setOverlayOpen(next);
        return;
      }
      setSaved(next);
      writeSiteSidebarCookie(next);
    },
    [overlay],
  );
  const toggleSiteMenu = useCallback(
    (trigger?: HTMLElement) => setSiteMenuExpanded(!expanded, trigger),
    [expanded, setSiteMenuExpanded],
  );

  useOverlayDismiss(
    overlay && overlayOpen,
    () => document.getElementById(SITE_SIDEBAR_ID),
    () => {
      setOverlayOpen(false);
      const trigger = returnFocus.current;
      returnFocusTo(() =>
        trigger?.isConnected
          ? trigger
          : document.querySelector<HTMLElement>('[data-site-sidebar-toggle]'),
      );
    },
    () => [document.querySelector<HTMLElement>('[data-site-sidebar-toggle]')],
  );

  // `[` collapses or expands the site sidebar from anywhere outside a text field.
  const toggleRef = useRef(toggleSiteMenu);
  toggleRef.current = toggleSiteMenu;
  useEffect(() => {
    if (!siteId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[' || !isPlainKey(event) || isTypingTarget(event.target)) return;
      if (window.matchMedia(MOBILE_QUERY).matches) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [siteId]);

  const value = useMemo<SiteNavigationContextValue>(
    () => ({
      isSiteRoute: siteId !== null,
      siteId,
      siteMenuExpanded: expanded,
      siteMenuOverlay: overlay,
      setSiteMenuExpanded,
      toggleSiteMenu,
    }),
    [expanded, overlay, setSiteMenuExpanded, siteId, toggleSiteMenu],
  );
  return <SiteNavigationContext.Provider value={value}>{children}</SiteNavigationContext.Provider>;
};
