import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAppSelector } from '@shared/hooks/redux';
import { selectGoogleConnection, selectGoogleConnectionSiteId, selectGoogleLoaded, selectGoogleReadiness } from '../store/selectors';
import type { SiteGoogleReadiness } from '../types';
import { GoogleReadinessNotice, type GoogleProduct } from './GoogleReadinessNotice';

const NOT_CONNECTED: SiteGoogleReadiness = {
  gsc: { status: 'not_connected', matching: false },
  ga4: { status: 'not_connected', matching: false },
};

interface Value { siteId: string; domain: string; readiness: SiteGoogleReadiness | undefined }
const Context = createContext<Value | null>(null);

/** Prefer the current Google configuration over the site's earlier list response. */
export function SiteGoogleReadinessProvider({ siteId, domain, readiness: fromSite, children }: {
  siteId: string;
  domain: string;
  readiness: SiteGoogleReadiness | undefined;
  children: ReactNode;
}) {
  const connection = useAppSelector(selectGoogleConnection);
  const connectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const loaded = useAppSelector(selectGoogleLoaded);
  const fromConnection = useAppSelector(selectGoogleReadiness);
  const readiness = loaded && connectionSiteId === siteId
    ? connection?.status === 'connected' ? (fromConnection ?? fromSite) : NOT_CONNECTED
    : fromSite;
  const value = useMemo(() => ({ siteId, domain, readiness }), [siteId, domain, readiness]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useSiteGoogleReadiness = (): Value | null => useContext(Context);

export function SiteGoogleNotice({ product, showAction = true }: { product: GoogleProduct; showAction?: boolean }) {
  const value = useSiteGoogleReadiness();
  if (!value) return null;
  if (!showAction && value.readiness?.[product].status === 'not_connected') return null;
  return <GoogleReadinessNotice siteId={value.siteId} domain={value.domain}
    product={product} readiness={value.readiness?.[product]} showAction={showAction} />;
}
