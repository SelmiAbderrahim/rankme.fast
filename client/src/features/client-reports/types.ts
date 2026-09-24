import type { SupportedLocale } from '@shared/i18n';

export interface ClientReportSections {
  audit: boolean;
  ranks: boolean;
  gsc: boolean;
}

export interface ScheduledReport {
  id: string;
  siteId: string;
  name: string;
  frequency: 'weekly' | 'monthly';
  weekdayUtc: number | null;
  monthdayUtc: number | null;
  hourUtc: number;
  minuteUtc: number;
  locale: SupportedLocale;
  recipients: string[];
  sections: ClientReportSections;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledReportInput = Omit<
  ScheduledReport,
  'id' | 'siteId' | 'minuteUtc' | 'nextRunAt' | 'lastRunAt' | 'createdAt' | 'updatedAt'
>;

export interface ClientPortalLink {
  id: string;
  clientLabel: string;
  siteLabel: string;
  locale: SupportedLocale;
  sections: ClientReportSections;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedClientPortalLink extends ClientPortalLink {
  url: string;
}

export interface ClientReportsOverview {
  enabled: boolean;
  schedules: ScheduledReport[];
  portals: ClientPortalLink[];
}

export interface ScheduledReportDelivery {
  id: string;
  scheduleId: string;
  recipient: string;
  status: 'pending' | 'sent' | 'failed' | 'suppressed';
  suppressionReason: 'unsubscribed' | 'removed_member' | 'transport_unconfigured' | null;
  errorCode: string | null;
  snapshotDate: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DeliveriesPage {
  deliveries: ScheduledReportDelivery[];
  nextCursor: string | null;
}

export interface ClientPortalReport {
  /** Immutable artifact locale captured by the portal token. */
  locale: SupportedLocale;
  site: { label: string };
  branding: {
    companyName: string;
    accentColor: string;
    logoDataUrl: string | null;
  };
  sections: {
    audit: null | {
      snapshotDate: string;
      counts: { fixNow: number; watch: number; passed: number };
      findings: Array<{
        ruleId: string;
        bucket: 'fix-now' | 'watch' | 'passed';
        severity: 'critical' | 'warning' | 'info';
        affectedUrls: string[];
        title: string;
        why: string;
        fix: string;
      }>;
    };
    ranks: null | {
      snapshotDate: string;
      rows: Array<{
        keyword: string;
        engine: string;
        position: number | null;
        checkedAt: string;
      }>;
    };
    gsc: null | {
      snapshotDate: string;
      windowDays: 28;
      totalClicks: number;
      totalImpressions: number;
      averageCtr: number;
      averagePosition: number;
      topQueries: Array<{
        query: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
        snapshotDate: string;
      }>;
    };
  };
}

export interface PortalLoaderContext {
  apiOrigin?: string;
}
