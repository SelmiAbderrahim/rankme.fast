import { describe, expect, it } from 'vitest';
import i18next, { type Resource } from 'i18next';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { AppReviewStatsView } from '@features/app-seo/components/reviews/AppReviewStats';
import { GscTimeseriesChart } from '@features/google/components/GscTimeseriesChart';
import { PositionDelta } from '@shared/components/PositionDelta';
import { RESOURCES } from './resources';
import { SUPPORTED_LOCALES } from './locales';

const categories = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const counts = [0, 1, 2, 3, 11, 27, 100, 102];
const countPhrases = {
  "auth": ["security.deletion.graceDays", "security.deletion.graceHours"],
  "appSeoCharts": ["limit.description"],
  "brandRadar": [
    "detail.mentionCount",
    "detail.digest.citations"
  ],
  "google": [
    "breakdown.other",
    "searchSummary.timeseriesSubtitle",
    "searchSummary.timeseriesChartLabel",
    "searchSummary.timeseriesTableCaption",
    "analytics.timeseriesSubtitle",
    "analytics.timeseriesChartLabel",
    "analytics.timeseriesTableCaption",
    "analytics.staleBody",
    "searchDetail.sitemaps.status.errors",
    "searchDetail.sitemaps.status.warnings",
    "revoke.confirmBody"
  ],
  "report": [
    "progress.upTo",
    "gscBlock.sitemapErrors",
    "gscBlock.sitemapWarnings",
    "gscBlock.sitemapProcessed",
    "pageSpeed.sampleLabel",
    "row.affectedPages",
    "localSeoBlock.packSize",
    "exportUi.center.views",
    "pageCap.pages",
    "dismissed.title",
    "dismissed.stillDetected",
    "dismissed.resurfaced",
    "detail.measured.words",
    "detail.measured.characters",
    "aiSummary.basis",
    "stale.title"
  ],
  "keywordResearch": [
    "tracked.limitReached",
    "selectionCount",
    "clusters.selectionCount",
    "gap.resultCount",
    "clusters.resultTitle",
    "clusters.runRowTitle",
    "clusters.membersToggle",
    "clusters.truncatedNote",
    "history.shown"
  ],
  "alerts": [
    "list.capUsed",
    "list.emailCount",
    "log.domainCount"
  ],
  "audienceResearch": [
    "confirm.body",
    "progress.counts.sources",
    "progress.counts.signals",
    "signals.citationCount"
  ],
  "localSeo": [
    "refresh.cooldown",
    "setup.resultsLegend"
  ],
  "internalLinks": [
    "runs.suggestionCount"
  ],
  "ranks": [
    "checkCooldownCountdown",
    "suggestionsSelectedCount",
    "trendChartLabel",
    "trendTableSummary",
    "serpFeatures.ownedPaaCount",
    "serpFeatures.history.ownedYes",
    "addPreviewCount",
    "addSubmitCount",
    "addResult.added",
    "addResult.duplicates",
    "addResult.tooLong",
    "addResult.unsent",
    "jobOutcome.allChecked",
    "jobOutcome.checked"
  ],
  "actions": [
    "status.showing",
    "card.affectedCount",
    "card.affectedCountSampled",
    "card.seeAllUrls",
    "card.seeLinkTargets"
  ],
  "pages": [
    "disclosure.reportingLag", "crawl.pages",
    "detail.trendDescription",
    "detail.trendAria",
    "pagination.context",
    "detail.associatedCount",
    "coverage.pages",
    "coverage.skipped",
    "coverage.redirects"
  ],
  "aiVisibility": [
    "refresh.cooldown",
    "suggestions.cooldown",
    "refresh.success",
    "trend.chartLabel",
    "trend.tableSummary",
    "suggestions.generated"
  ],
  "backlinks": [
    "refresh.cooldown",
    "table.scope",
    "table.scopeNoTotal"
  ],
  "schemaGenerator": [
    "source.listCapped",
    "source.firstPages",
    "source.crawledPages"
  ],
  "cannibalization": [
    "counts.windowDays",
    "counts.queriesRead"
  ],
  "competitorsTraffic": [
    "compare.button",
    "compare.selectedCount"
  ],
  "appSeoListing": [
    "store.moreScreenshots"
  ],
  "docs": [
    "resultCount"
  ],
  "contentIntelligence": [
    "inventory.start.pageCount",
    "competitorContent.run.pageCount",
    "competitorContent.run.competitorCount",
    "list.warningCount",
    "detail.brief.versionMeta",
    "detail.draft.versionMeta",
    "detail.draft.wordCount",
    "opportunities.evidence",
    "inventory.findings.evidence",
    "competitorContent.findings.evidence",
    "briefs.preview.scrapes",
    "briefs.list.meta",
    "briefs.sources.meta"
  ],
  "keywordClusters": [
    "eligibility.needCheck", "eligibility.ready", "eligibility.minimum",
    "cluster.sharedWithPivot",
    "blocked.more",
    "scope.description",
    "newRun.scopeValue",
    "blocked.title",
    "cluster.grouped",
    "cluster.commonCore",
    "cluster.pivotWindow"
  ],
  "competitors": [
    "refresh.cooldown",
    "intelligence.detail.rowCount",
    "intelligence.detail.competitorCount",
    "intelligence.landscape.rowCount",
    "intelligence.landscape.description",
    "intelligence.landscape.selection",
    "intelligence.landscape.limit",
    "intelligence.detail.summary",
    "intelligence.landscape.competitorCount"
  ],
  "team": [
    "members.pageOf", "access.siteCount",
    "inbox.buttonLabelWithCount",
    "members.total",
    "access.outsideYourAccess",
    "received.pending"
  ],
  "appSeoTracking": [
    "mintPreview.count",
    "discover.selectedCount"
  ],
  "appSeoReviews": [
    "histogram.star"
  ],
  "reviewIntelligence": [
    "preview.depth",
    "preview.perSource",
    "inventory.stars",
    "stats.distribution.stars",
    "provenance.sampleCount",
    "stats.total",
    "themes.citationCount",
    "inventory.page"
  ],
  "common": [
    "positionDelta.improved",
    "positionDelta.declined",
    "positionDelta.window.previousSync",
    "dashboard.health.fixNow.open",
    "dashboard.health.showing",
    "dashboard.health.seeAll",
    "dashboard.health.paused.more",
    "phraseList.more",
    "phraseList.overPasteLimit",
    "dashboard.health.search.clicks",
    "dashboard.health.search.impressions",
    "dashboard.health.rank.notCompared.failed",
    "dashboard.health.rank.notCompared.skipped",
    "dashboard.health.rank.notCompared.noPair",
    "dashboard.health.rank.notCompared.unranked"
  ],
  "geogrid": [
    "center.place.resultsLegend"
  ]
} as const;

describe('counted product copy', () => {
  it.each(SUPPORTED_LOCALES)('selects each explicit CLDR category in %s', async (locale) => {
    const instance = i18next.createInstance();
    await instance.init({ lng: locale, fallbackLng: false, resources: RESOURCES as Resource });
    for (const [namespace, keys] of Object.entries(countPhrases)) for (const key of keys) {
      const qualified = `${namespace}:${key}`;
      for (const category of categories) expect(instance.exists(`${qualified}_${category}`), `${locale} ${qualified}_${category}`).toBe(true);
      for (const count of counts) {
        const category = count === 0 ? 'zero' : new Intl.PluralRules(locale).select(count);
        const vars = { expected: '2026-10-14', totalPages: count, metric: 'clicks', title: 'Example', name: 'Example', matched: count, maxResults: count, maxKeywords: count, minutes: count, count, hidden: count, value: count, maxPages: count, cap: count, depth: count,
          n: count, total: count, shown: count, pages: count, page: 1, citations: count, selected: count,
          mentioned: count, seconds: count, sources: count, stars: count, star: count, days: count,
          max: 100, min: 3, limit: count, date: '2026-10-14', domain: 'example.test', phrase: 'sample', query: 'sample', loaded: count, measured: count, checked: count, shared: count, window: count, keywords: count };
        const rendered = instance.t(qualified, vars);
        expect(rendered).toBe(instance.t(`${qualified}_${category}`, vars));
        expect(rendered, `${locale} ${qualified}`).not.toMatch(/\{\{|\$t\(/);
      }
    }
  });
  it.each([
    [0, '0 نتائج'], [1, '1 نتيجة'], [2, '2 من النتائج'], [3, '3 نتائج'],
    [11, '11 نتيجة'], [27, '27 نتيجة'], [100, '100 نتيجة'], [102, '102 نتيجة'],
  ] as const)('uses Arabic result grammar for %s', async (count, expected) => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'ar', resources: RESOURCES as Resource });
    expect(instance.t('report:localSeoBlock.packSize', { count })).toBe(expected);
  });
  it('keeps independent quantities grammatical', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', resources: RESOURCES as Resource });
    expect(instance.t('competitors:intelligence.detail.rollupDescription', { rows: 1, usable: 2 })).toBe('1 keyword row across 2 competitors.');
    expect(instance.t('competitors:intelligence.detail.rollupDescription', { rows: 2, usable: 1 })).toBe('2 keyword rows across 1 competitor.');
    expect(instance.t('google:searchSummary.timeseriesSubtitle', { count: 1, days: 1 })).toBe('Daily totals for the last 1 day.');
  });
  it('selects singular grammar in the actual review histogram', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', resources: RESOURCES as Resource });
    render(<I18nextProvider i18n={instance}><AppReviewStatsView stats={{ total: 1, averageRating: 1,
      histogram: [{ star: 1, count: 1 }], ratingMix: { positive: 0, neutral: 0, negative: 1 }, volumeTrend: [] }} /></I18nextProvider>);
    expect(screen.getAllByText('1 star')).toHaveLength(2);
    expect(screen.queryByText('1 stars')).not.toBeInTheDocument();
  });
  it('selects Arabic few-day grammar through the actual Search Console chart', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'ar', resources: RESOURCES as Resource });
    render(<I18nextProvider i18n={instance}><GscTimeseriesChart days={7} points={[{
      date: '2026-10-14', clicks: 1, impressions: 2, ctr: 0.5, position: 1,
    }]} /></I18nextProvider>);
    expect(screen.getByTestId('gsc-timeseries-svg')).toHaveAccessibleName(/7 أيام/);
    expect(screen.getByTestId('gsc-timeseries-table')).toHaveAccessibleName(/7 أيام/);
  });
  it.each([
    [0, 'مراكز'], [1, 'مركز'], [2, 'من المراكز'], [3, 'مراكز'],
    [11, 'مركز'], [27, 'مركز'], [100, 'مركز'], [102, 'مركز'],
  ] as const)('passes the raw Arabic position count for %s', async (count, noun) => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'ar', defaultNS: 'common', resources: RESOURCES as Resource });
    render(<I18nextProvider i18n={instance}><PositionDelta variant="full" movement={{ kind: 'improved', amount: count }} /></I18nextProvider>);
    const displayed = new Intl.NumberFormat('ar', { maximumFractionDigits: 1 }).format(count);
    expect(screen.getAllByText(`تحسّن بمقدار ${displayed} ${noun}`)).toHaveLength(2);
  });
  it.each([
    ['en', 1, 'This selection adds 1 keyword.'], ['en', 2, 'This selection adds 2 keywords.'],
    ['ar', 0, 'سيضيف هذا الاختيار 0 من الكلمات المفتاحية.'],
    ['ar', 1, 'سيضيف هذا الاختيار كلمة مفتاحية واحدة (1).'],
    ['ar', 2, 'سيضيف هذا الاختيار كلمتين مفتاحيتين (2).'],
    ['ar', 3, 'سيضيف هذا الاختيار 3 كلمات مفتاحية.'],
    ['ar', 11, 'سيضيف هذا الاختيار 11 كلمة مفتاحية.'],
    ['ar', 27, 'سيضيف هذا الاختيار 27 كلمة مفتاحية.'],
    ['ar', 100, 'سيضيف هذا الاختيار 100 كلمة مفتاحية.'],
    ['ar', 102, 'سيضيف هذا الاختيار 102 كلمة مفتاحية.'],
    ['de', 1, 'Mit dieser Auswahl fügen Sie 1 Keyword hinzu.'],
  ] as const)('previews the actual keyword quantity in %s for %s', async (locale, count, expected) => {
    const instance = i18next.createInstance();
    await instance.init({ lng: locale, resources: RESOURCES as Resource });
    expect(instance.t('appSeoTracking:mintPreview.count', { count })).toBe(expected);
  });
  it('uses the German singular for a one-second suggestion cooldown', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'de', resources: RESOURCES as Resource });
    expect(instance.t('aiVisibility:suggestions.cooldown', { count: 1, seconds: 1 })).toBe('Warten Sie 1 Sekunde, bevor Sie erneut generieren.');
    expect(instance.t('aiVisibility:suggestions.cooldown', { count: 2, seconds: 2 })).toBe('Warten Sie 2 Sekunden, bevor Sie erneut generieren.');
  });
  it.each([
    ['en', 'Stored keywords shown: 1 of 100. Search to narrow the list.', 'Stored keywords shown: 100 of 1. Search to narrow the list.'],
    ['fr', 'Mots-clés enregistrés affichés : 1 sur 100. Recherchez pour affiner la liste.', 'Mots-clés enregistrés affichés : 100 sur 1. Recherchez pour affiner la liste.'],
    ['es', 'Palabras clave guardadas que se muestran: 1 de 100. Busque para acotar la lista.', 'Palabras clave guardadas que se muestran: 100 de 1. Busque para acotar la lista.'],
    ['ru', 'Показано сохранённых ключевых слов: 1 из 100. Используйте поиск, чтобы сузить список.', 'Показано сохранённых ключевых слов: 100 из 1. Используйте поиск, чтобы сузить список.'],
  ] as const)('keeps shown and total keyword quantities independent in %s', async (locale, singleShown, singleTotal) => {
    const instance = i18next.createInstance();
    await instance.init({ lng: locale, resources: RESOURCES as Resource });
    expect(instance.t('keywordResearch:clusters.truncatedNote', { count: 1, total: 100 })).toBe(singleShown);
    expect(instance.t('keywordResearch:clusters.truncatedNote', { count: 100, total: 1 })).toBe(singleTotal);
  });
  it('keeps measured and total French canonical-page quantities independent', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'fr', resources: RESOURCES as Resource });
    expect(instance.t('pages:coverage.pages', { measured: 1, count: 10 })).toBe('Pages canoniques avec données de recherche : 1 sur 10.');
    expect(instance.t('pages:coverage.pages', { measured: 10, count: 1 })).toBe('Pages canoniques avec données de recherche : 10 sur 1.');
  });
  it('composes page and competitor quantities without reservation claims', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', resources: RESOURCES as Resource });
    expect(instance.t('contentIntelligence:inventory.start.blocks', { pages: 1 })).toBe('Up to 1 page.');
    expect(instance.t('contentIntelligence:inventory.start.blocks', { pages: 20 })).toBe('Up to 20 pages.');
    expect(instance.t('contentIntelligence:competitorContent.run.disclosure', { count: 1, pages: 2 })).toBe('This run reads up to 2 pages across 1 competitor.');
    expect(instance.t('contentIntelligence:competitorContent.run.disclosure', { count: 2, pages: 1 })).toBe('This run reads up to 1 page across 2 competitors.');
    await instance.changeLanguage('de');
    expect(instance.t('contentIntelligence:competitorContent.run.disclosure', { count: 2, pages: 1 })).toBe('Dieser Lauf liest bis zu 1 Seite. Der Vergleich umfasst 2 Wettbewerber.');
    await instance.changeLanguage('ar');
    expect(instance.t('contentIntelligence:competitorContent.run.disclosure', { count: 2, pages: 3 })).toBe('تقرأ هذه العملية حتى 3 صفحات عبر 2 من المنافسين.');
    expect(instance.t('contentIntelligence:competitorContent.run.disclosure', { count: 1, pages: 2 })).toBe('تقرأ هذه العملية حتى 2 من الصفحات عبر 1 منافس.');

  });
  it('passes numeric counts through the actual position-change consumer', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', defaultNS: 'common', resources: RESOURCES as Resource });
    render(<I18nextProvider i18n={instance}><PositionDelta variant="full" fallbackDelta={1} /></I18nextProvider>);
    expect(screen.getAllByText('Improved by 1 position')).toHaveLength(2);
    expect(screen.queryByText('Improved by 1 positions')).not.toBeInTheDocument();
  });
});
