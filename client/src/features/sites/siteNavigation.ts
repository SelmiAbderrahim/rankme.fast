import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bot,
  Boxes,
  ClipboardCheck,
  FileBarChart,
  FileText,
  Grid2X2,
  KeyRound,
  Link2,
  MapPinned,
  MessageSquareText,
  Network,
  PanelsTopLeft,
  PenLine,
  Radar,
  ScanSearch,
  Search,
  Table2,
  Tags,
  Target,
  UsersRound,
  Waypoints,
  Zap,
} from 'lucide-react';

/**
 * The single source of truth for site navigation. Consumers use this same
 * typed list for the desktop menu, mobile sheet, breadcrumbs, and command
 * palette entries. Query-string URLs are intentional: existing site panels
 * own their `?view=`, `?bucket=`, and `?retest=` state.
 */
const SITE_NAV_ITEM_DEFINITIONS = [
  { id: 'overview', labelKey: 'sites:workspace.tabs.overview', icon: PanelsTopLeft, group: null },
  { id: 'pages', labelKey: 'pages:workspaceTab', icon: Table2, group: 'audit-reports' },
  { id: 'actions', labelKey: 'sites:workspace.tabs.actions', icon: Zap, group: 'audit-reports' },
  { id: 'report', labelKey: 'sites:workspace.tabs.report', icon: FileBarChart, group: 'audit-reports' },
  { id: 'client-reports', labelKey: 'clientReports:dashboard.title', icon: FileText, group: 'audit-reports' },
  { id: 'keywords', labelKey: 'sites:workspace.tabs.keywords', icon: Target, group: 'search' },
  { id: 'serp-features', labelKey: 'sites:workspace.tabs.serpFeatures', icon: Search, group: 'search' },
  { id: 'keyword-clusters', labelKey: 'sites:workspace.tabs.keywordClusters', icon: Network, group: 'search' },
  { id: 'research', labelKey: 'sites:workspace.tabs.research', icon: KeyRound, group: 'search' },
  { id: 'traffic', labelKey: 'competitorsTraffic:title', icon: BarChart3, group: 'visibility' },
  { id: 'backlinks', labelKey: 'sites:workspace.tabs.backlinks', icon: Link2, group: 'visibility' },
  { id: 'competitors', labelKey: 'sites:workspace.tabs.competitors', icon: UsersRound, group: 'visibility' },
  { id: 'ai-visibility', labelKey: 'sites:workspace.tabs.aiVisibility', icon: Bot, group: 'visibility' },
  { id: 'brand-radar', labelKey: 'sites:workspace.tabs.brandRadar', icon: Radar, group: 'visibility' },
  { id: 'apps', labelKey: 'sites:workspace.tabs.apps', icon: Boxes, group: 'local-apps' },
  { id: 'local-seo', labelKey: 'sites:workspace.tabs.localSeo', icon: MapPinned, group: 'local-apps' },
  { id: 'reviews', labelKey: 'sites:workspace.tabs.reviews', icon: MessageSquareText, group: 'local-apps' },
  { id: 'geogrid', labelKey: 'sites:workspace.tabs.geogrid', icon: Grid2X2, group: 'local-apps' },
  { id: 'google', labelKey: 'sites:workspace.tabs.google', icon: ScanSearch, group: 'search' },
  { id: 'content', labelKey: 'sites:workspace.tabs.content', icon: PenLine, group: 'content' },
  { id: 'internal-links', labelKey: 'sites:workspace.tabs.internalLinks', icon: Waypoints, group: 'content' },
  { id: 'cannibalization', labelKey: 'sites:workspace.tabs.cannibalization', icon: Tags, group: 'content' },
  { id: 'audience-research', labelKey: 'sites:workspace.tabs.audienceResearch', icon: MessageSquareText, group: 'content' },
  { id: 'schema', labelKey: 'sites:workspace.tabs.schema', icon: ClipboardCheck, group: 'content' },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: string;
  icon: LucideIcon;
  group: SiteNavGroupId | null;
  badge?: string;
}>;

export const SITE_NAV_ITEMS = SITE_NAV_ITEM_DEFINITIONS.map((item) => ({
  ...item,
  /** Canonical route template; siteTabHref preserves the active query state. */
  href: `/sites/:siteId?tab=${item.id}`,
}));

export type SiteTab = (typeof SITE_NAV_ITEMS)[number]['id'];
export type SiteNavItem = (typeof SITE_NAV_ITEMS)[number];
export type SiteNavGroupId = 'audit-reports' | 'search' | 'visibility' | 'content' | 'local-apps';

export const SITE_NAV_GROUPS = [
  { id: 'audit-reports', labelKey: 'sites:workspace.groups.auditReports' },
  { id: 'search', labelKey: 'sites:workspace.groups.search' },
  { id: 'visibility', labelKey: 'sites:workspace.groups.visibility' },
  { id: 'content', labelKey: 'sites:workspace.groups.content' },
  { id: 'local-apps', labelKey: 'sites:workspace.groups.localApps' },
] as const satisfies ReadonlyArray<{ id: SiteNavGroupId; labelKey: string }>;

export const SITE_TABS = SITE_NAV_ITEMS.map(({ id }) => id) as unknown as readonly SiteTab[];

export const SITE_TAB_LABEL_KEYS: Readonly<Record<SiteTab, string>> = Object.fromEntries(
  SITE_NAV_ITEMS.map(({ id, labelKey }) => [id, labelKey]),
) as Record<SiteTab, string>;

const workflowOrder = new Map(SITE_NAV_ITEM_DEFINITIONS.map((item, index) => [item.id, index]));
// Actions lead the audit workflow even though the public tab enumeration predates them.
workflowOrder.set('actions', 1);
workflowOrder.set('pages', 2);
workflowOrder.set('apps', 100);

export const getSiteNavGroupItems = (group: SiteNavGroupId): SiteNavItem[] =>
  SITE_NAV_ITEMS.filter((item) => item.group === group)
    .sort((a, b) => workflowOrder.get(a.id)! - workflowOrder.get(b.id)!);

export const SITE_TAB_GROUPS = SITE_NAV_GROUPS.map((group) => ({
  ...group,
  tabs: getSiteNavGroupItems(group.id).map(({ id }) => id),
})) as ReadonlyArray<{ id: SiteNavGroupId; labelKey: string; tabs: readonly SiteTab[] }>;

export const siteTabHref = (siteId: string, tab: SiteTab, currentSearch = '', hash = ''): string => {
  const params = new URLSearchParams(currentSearch);
  params.set('tab', tab);
  const template = getSiteNavItem(tab).href;
  return `${template.replace(':siteId', encodeURIComponent(siteId)).split('?')[0]}?${params.toString()}${hash}`;
};

export const getSiteNavItem = (tab: SiteTab): SiteNavItem =>
  SITE_NAV_ITEMS.find((item) => item.id === tab) ?? SITE_NAV_ITEMS[0]!;
