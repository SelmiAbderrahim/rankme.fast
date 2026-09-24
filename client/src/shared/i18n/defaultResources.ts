import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enAuth from './locales/en/auth.json';
import enEmail from './locales/en/email.json';
import enLanguage from './locales/en/language.json';
import enSites from './locales/en/sites.json';
import enPages from './locales/en/pages.json';
import enReport from './locales/en/report.json';
import enRanks from './locales/en/ranks.json';
import enGoogle from './locales/en/google.json';
import enKeywordResearch from './locales/en/keywordResearch.json';
import enBacklinks from './locales/en/backlinks.json';
import enCompetitors from './locales/en/competitors.json';
import enCompetitorsTraffic from './locales/en/competitorsTraffic.json';
import enAiVisibility from './locales/en/aiVisibility.json';
import enBrandRadar from './locales/en/brandRadar.json';
import enAlerts from './locales/en/alerts.json';
import enCannibalization from './locales/en/cannibalization.json';
import enInternalLinks from './locales/en/internalLinks.json';
import enKeywordClusters from './locales/en/keywordClusters.json';
import enLocalSeo from './locales/en/localSeo.json';
import enGeogrid from './locales/en/geogrid.json';
import enReviewIntelligence from './locales/en/reviewIntelligence.json';
import enTeam from './locales/en/team.json';
import enSettings from './locales/en/settings.json';
import enAccount from './locales/en/account.json';
import enContentIntelligence from './locales/en/contentIntelligence.json';
import enAudienceResearch from './locales/en/audienceResearch.json';
import enSchemaGenerator from './locales/en/schemaGenerator.json';
import enWeeklyPulse from './locales/en/weeklyPulse.json';
import enActions from './locales/en/actions.json';
import enDocs from './locales/en/docs.json';
import enAssistant from './locales/en/assistant.json';
import enClientReports from './locales/en/clientReports.json';
import enAppSeo from './locales/en/appSeo.json';
import enAppSeoTracking from './locales/en/appSeoTracking.json';
import enAppSeoCharts from './locales/en/appSeoCharts.json';
import enAppSeoResearch from './locales/en/appSeoResearch.json';
import enAppSeoReviews from './locales/en/appSeoReviews.json';
import enAppSeoCompare from './locales/en/appSeoCompare.json';
import enAppSeoListing from './locales/en/appSeoListing.json';
import type { Namespace } from './locales';

export const DEFAULT_RESOURCES: { en: Record<Namespace, unknown> } = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    email: enEmail,
    language: enLanguage,
    sites: enSites,
    pages: enPages,
    report: enReport,
    ranks: enRanks,
    google: enGoogle,
    keywordResearch: enKeywordResearch,
    backlinks: enBacklinks,
    competitors: enCompetitors,
    competitorsTraffic: enCompetitorsTraffic,
    aiVisibility: enAiVisibility,
    brandRadar: enBrandRadar,
    alerts: enAlerts,
    cannibalization: enCannibalization,
    internalLinks: enInternalLinks,
    keywordClusters: enKeywordClusters,
    localSeo: enLocalSeo,
    geogrid: enGeogrid,
    reviewIntelligence: enReviewIntelligence,
    team: enTeam,
    settings: enSettings,
    account: enAccount,
    contentIntelligence: enContentIntelligence,
    audienceResearch: enAudienceResearch,
    schemaGenerator: enSchemaGenerator,
    weeklyPulse: enWeeklyPulse,
    actions: enActions,
    docs: enDocs,
    assistant: enAssistant,
    clientReports: enClientReports,
    appSeo: enAppSeo,
    appSeoTracking: enAppSeoTracking,
    appSeoCharts: enAppSeoCharts,
    appSeoResearch: enAppSeoResearch,
    appSeoReviews: enAppSeoReviews,
    appSeoCompare: enAppSeoCompare,
    appSeoListing: enAppSeoListing,
  },
};
