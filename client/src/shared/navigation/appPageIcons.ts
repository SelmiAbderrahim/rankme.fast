import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  BookOpenText,
  Bot,
  Cable,
  CircleUserRound,
  FileText,
  FileArchive,
  Globe2,
  History,
  LayoutDashboard,
  LockKeyhole,
  PanelsTopLeft,
  Search,
  TrendingUp,
  UsersRound,
} from 'lucide-react';

/**
 * One visual vocabulary for app navigation and page headings. Direct sidebar
 * destinations reuse the same entry on their page; first-level children have
 * their own entries so their more specific context remains recognizable.
 */
export const APP_PAGE_ICONS = {
  dashboard: LayoutDashboard,
  assistant: Bot,
  sites: Globe2,
  keywordResearch: Search,
  alerts: BellRing,
  docs: BookOpenText,
  exports: FileArchive,
  profile: CircleUserRound,
  team: UsersRound,
  google: Cable,
  notifications: Bell,
  security: LockKeyhole,
  siteWorkspace: PanelsTopLeft,
  keywordHistory: History,
  keywordLiveTrends: TrendingUp,
  docsArticle: FileText,
} as const satisfies Record<string, LucideIcon>;

export const SIDEBAR_ICON_KEYS = [
  'dashboard',
  'assistant',
  'sites',
  'keywordResearch',
  'alerts',
  'docs',
  'exports',
  'profile',
  'team',
  'google',
  'notifications',
  'security',
] as const satisfies readonly (keyof typeof APP_PAGE_ICONS)[];

export type AppPageIconKey = keyof typeof APP_PAGE_ICONS;
