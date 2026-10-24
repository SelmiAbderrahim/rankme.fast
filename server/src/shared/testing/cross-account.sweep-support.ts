import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { setAiVisibilityDb } from '../../modules/ai-visibility/ai-visibility.holder.js';
import { setAlertsDb } from '../../modules/alerts/alerts.holder.js';
import { setApiKeysDb } from '../../modules/api-keys/api-keys.holder.js';
import { setAppSeoDb } from '../../modules/app-seo/app-seo.holder.js';
import { setAudienceResearchDb } from '../../modules/audience-research/audience-research.holders.js';
import { setSummaryDb } from '../../modules/audits/summary.db-holder.js';
import { setBacklinkProvider, setBacklinksDb } from '../../modules/backlinks/backlinks.holder.js';
import { setBrandRadarDb } from '../../modules/brand-radar/brand-radar.holder.js';
import { setCannibalizationDb } from '../../modules/cannibalization/cannibalization.holder.js';
import { setClientReportsDb } from '../../modules/client-reports/client-reports.db-holder.js';
import { setCompetitorContentDb } from '../../modules/competitor-content/competitor-content.holders.js';
import { setCompetitorProvider, setCompetitorsDb } from '../../modules/competitors/competitors.holder.js';
import { setCompetitorLandscapeDb } from '../../modules/competitors/landscape/landscape.holder.js';
import { setContentBriefDb } from '../../modules/content-briefs/content-brief.holder.js';
import { setContentIntelligenceDb } from '../../modules/content-intelligence/content-intelligence.holders.js';
import { setContentMonitorDb } from '../../modules/content-monitoring/monitoring.holders.js';
import { setGeogridDb } from '../../modules/geogrid/geogrid.holder.js';
import { getGoogleConnectionsDb, setGoogleConnectionsDb } from '../../modules/google-connections/google-connections.service.js';
import { setGoogleGa4Provider } from '../../modules/google-connections/google-ga4-holder.js';
import { setGoogleGscProvider } from '../../modules/google-connections/google-gsc-holder.js';
import { setInternalLinksDb } from '../../modules/internal-links/internal-links.holder.js';
import { setKeywordClustersDb } from '../../modules/keyword-clusters/keyword-clusters.holder.js';
import { setKeywordProvider, setKeywordResearchDb } from '../../modules/keyword-research/keyword-research.holder.js';
import { setLocalSeoDb, setLocalSeoProvider } from '../../modules/local-seo/local-seo.holder.js';
import { setMarketCatalogDeps } from '../../modules/market-catalog/market-catalog.holder.js';
import { setRanksDb } from '../../modules/ranks/ranks.queue-holder.js';
import { setReportExportsDb } from '../../modules/report-exports/report-exports.holder.js';
import { setSitesDb } from '../../modules/sites/sites.holder.js';
import { setTeamDb } from '../../modules/team/team.holder.js';
import { setWeeklyPulseDb } from '../../modules/weekly-pulse/weekly-pulse.controller.js';
import { createFakeAppDataProvider, createFakeBacklinkProvider, createFakeCompetitorProvider, createFakeContentAnalysisProvider, createFakeGa4Provider, createFakeGscProvider, createFakeKeywordProvider, createFakeLocalListingsProvider } from '../providers/fakes.js';

const DB_SETTERS = [
    setAiVisibilityDb, setAlertsDb, setApiKeysDb, setAppSeoDb, setAudienceResearchDb, setSummaryDb,
    setBacklinksDb, setBrandRadarDb, setCannibalizationDb, setClientReportsDb, setCompetitorContentDb,
    setCompetitorsDb, setCompetitorLandscapeDb, setContentBriefDb, setContentIntelligenceDb,
    setContentMonitorDb, setGeogridDb, setInternalLinksDb, setKeywordClustersDb, setKeywordResearchDb,
    setLocalSeoDb, setRanksDb, setReportExportsDb, setSitesDb, setTeamDb, setWeeklyPulseDb,
] as Array<(db: unknown) => void>;

let previousGoogleDb = getGoogleConnectionsDb();

export function installSweepHolders(db: unknown): void {
    for (const setDb of DB_SETTERS) setDb(db);
    previousGoogleDb = getGoogleConnectionsDb();
    setGoogleConnectionsDb(db as never);
    setGoogleGa4Provider(createFakeGa4Provider());
    setGoogleGscProvider(createFakeGscProvider());
    setKeywordProvider(createFakeKeywordProvider());
    setCompetitorProvider(createFakeCompetitorProvider());
    setBacklinkProvider(createFakeBacklinkProvider());
    setLocalSeoProvider(createFakeLocalListingsProvider());
    setMarketCatalogDeps({ db: db as never, keywordProvider: createFakeKeywordProvider(), contentAnalysisProvider: createFakeContentAnalysisProvider(), appDataProvider: createFakeAppDataProvider() });
}

export function removeSweepHolders(): void {
    for (const setDb of DB_SETTERS) setDb(null);
    setGoogleConnectionsDb(previousGoogleDb);
    setGoogleGa4Provider(null);
    setGoogleGscProvider(null);
    setKeywordProvider(null);
    setCompetitorProvider(null);
    setBacklinkProvider(null);
    setLocalSeoProvider(null);
    setMarketCatalogDeps(null);
}

export type IdShape = 'objectId' | 'uuid' | 'sha256' | 'page';
export const ID_SHAPES: readonly IdShape[] = ['objectId', 'uuid', 'sha256', 'page'];

/** Populate site paths with real owner ids and independent, syntactically valid child ids. */
export function fillChildren(path: string, siteId: string, shape: IdShape): string {
    return path.replace(/:([A-Za-z0-9_]+)/gu, (_match, name: string) => {
        if (name === 'siteId') return siteId;
        if (shape === 'uuid') return randomUUID();
        if (shape === 'sha256') return randomBytes(32).toString('hex');
        if (shape === 'page') return randomBytes(32).toString('base64url');
        return new Types.ObjectId().toHexString();
    });
}
