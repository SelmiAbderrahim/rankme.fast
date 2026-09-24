/**
 * Feature-truth drift test — spec 15 §1 (inline correction 5).
 *
 * `feature-truth.ts` is a literal manifest (no modules/** imports). This
 * suite pins every literal to the code that owns it:
 *
 *  (b) every non-empty `states` list strictly equals the module-exported enum;
 *  (c) every `docsSlugs` entry is in the docs-integrity SLUGS catalog;
 *  (d) 3-way slug-list sync — client docsUrl DOCS_SLUGS == seo.data
 *      DOCS_SLUGS == gen-docs SLUGS (the two non-importable files are
 *      regex-parsed, like docs-consistency.test.ts does);
 *  (e) every `flags` entry is a superadmin kill-switch key or an env-schema
 *      key. (`FEATURE_FLAG_KEYS` is imported from its canonical definition,
 *      `db/schema/feature-flags.ts` — the superadmin-intelligence module
 *      imports it from there too and does not re-export it.)
 *
 * Bonus: every routePrefix literal appears as an `app.use('<prefix>'` mount
 * in server/src/app.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_FLAG_KEYS } from '../../db/schema/feature-flags.js';
import { ACTION_STATES } from '../../db/schema/action-events.js';
import { RANK_DROP_CONFIRMATION_STATES } from '../../db/schema/rank-drop-confirmations.js';
import { WEEKLY_PULSE_RUN_STATUSES } from '../../db/schema/weekly-pulse.js';
import { KEYWORD_CLUSTER_DECISION_KINDS } from '../../db/schema/keyword-cluster-decision-events.js';
import { AUDIENCE_RESEARCH_STATES } from '../../modules/audience-research/audience-research.state.js';
import { CONTENT_ANALYSIS_STATUSES } from '../../modules/content-intelligence/content-analysis.model.js';
import { CONTENT_INVENTORY_STATUSES } from '../../modules/content-intelligence/inventory.model.js';
import { COMPETITOR_CONTENT_STATUSES } from '../../modules/competitor-content/competitor-content.model.js';
import { CONTENT_MONITOR_STATUSES } from '../../modules/content-monitoring/monitor.model.js';
import { LINK_INTELLIGENCE_RUN_STATUSES } from '../../modules/backlinks/backlink-runs.model.js';
import { TRAFFIC_SNAPSHOT_RUN_STATUSES } from '../../modules/competitors/traffic-snapshots.model.js';
import { TRENDS_EXPLORATION_STATUSES } from '../../modules/keyword-research/trends-explorations.model.js';
import { REVIEW_SYNC_RUN_STATUSES } from '../../modules/local-seo/review-sync.model.js';
import { BRAND_RADAR_SCAN_STATUSES } from '../../modules/brand-radar/brand-radar.model.js';
import { KEYWORD_CLUSTER_RUN_STATUSES } from '../../modules/keyword-clusters/keyword-clusters.schemas.js';
import { TOXICITY_REVIEW_STATUSES } from '../../modules/backlinks/toxicity-review.model.js';
import { ALERT_DELIVERY_STATUSES } from '../../db/schema/alert-deliveries.js';
import { INTERNAL_LINK_RUN_STATUSES } from '../../modules/internal-links/internal-links.schemas.js';
import { CONTENT_BRIEF_STATUSES } from '../../modules/content-briefs/content-brief.model.js';
import { GEOGRID_SCAN_STATUSES } from '../../db/schema/geogrid.js';
import { SCHEMA_GENERATION_STATUSES } from '../../modules/schema-generator/schema-generation.model.js';
import { CLIENT_REPORT_DELIVERY_STATUSES } from '../../db/schema/client-reports.js';
import { DOCS_SLUGS as SEO_DOCS_SLUGS } from '../../modules/seo/seo.data.js';
import { FEATURE_TRUTH } from './feature-truth.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

/** Extract the quoted slug literals from an array block in raw source. */
function slugsFromBlock(block: string): string[] {
  return [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1] as string);
}

function parseArray(source: string, re: RegExp, label: string): string[] {
  const match = source.match(re);
  if (!match || !match[1]) throw new Error(`could not parse ${label}`);
  return slugsFromBlock(match[1]);
}

const integritySlugs = parseArray(
  read('server/src/shared/docs/docs-integrity.test.ts'),
  /const SLUGS = \[([\s\S]*?)\] as const/,
  'docs-integrity SLUGS',
);

const clientSlugs = parseArray(
  read('client/src/shared/docs/docsUrl.ts'),
  /export const DOCS_SLUGS = \[([\s\S]*?)\] as const/,
  'client DOCS_SLUGS',
);

const genDocsSlugs = parseArray(
  read('scripts/gen-docs.mjs'),
  /const SLUGS = \[([\s\S]*?)\];/,
  'gen-docs SLUGS',
);

const withoutIndex = (slugs: readonly string[]): string[] =>
  [...slugs].filter((slug) => slug !== 'index').sort();

const ENTRIES = Object.entries(FEATURE_TRUTH);

const COMMUNITY_ENTRY_CONTRACT = {
  serpFeatureTracking: {
    docsSlugs: ['serp-features'],
    routePrefixes: ['/api/sites', '/api/keywords'],
    flags: ['SERP_FEATURE_TRACKING_ENABLED'],
  },
  keywordClustering: {
    docsSlugs: ['keyword-clustering'],
    routePrefixes: ['/api/sites', '/api/keyword-cluster-runs'],
    flags: ['KEYWORD_CLUSTERING_ENABLED'],
  },
  altEngineTracking: {
    docsSlugs: ['alt-engine-tracking', 'rank-tracking'],
    routePrefixes: ['/api/sites', '/api/keywords'],
    flags: ['ALT_ENGINE_TRACKING_ENABLED'],
  },
  cannibalization: {
    docsSlugs: ['cannibalization'],
    routePrefixes: ['/api/sites', '/api/cannibalization-reports'],
    flags: ['CANNIBALIZATION_ENABLED'],
  },
  toxicLinks: {
    docsSlugs: ['toxic-links'],
    routePrefixes: ['/api/backlinks'],
    flags: ['TOXIC_LINKS_ENABLED'],
  },
  alerts: {
    docsSlugs: ['alerts'],
    routePrefixes: ['/api/alerts'],
    flags: ['ALERTS_ENABLED'],
  },
  internalLinking: {
    docsSlugs: ['internal-linking'],
    routePrefixes: ['/api/sites', '/api/internal-link-runs'],
    flags: ['INTERNAL_LINKING_ENABLED'],
  },
  contentBriefs: {
    docsSlugs: ['content-briefs'],
    // Parent spec §18 narrows the stale /api/content-briefs draft to the real mount.
    routePrefixes: ['/api/sites'],
    flags: ['CONTENT_BRIEFS_ENABLED'],
  },
  geogrid: {
    docsSlugs: ['geogrid', 'local-seo'],
    routePrefixes: ['/api/sites'],
    flags: ['GEOGRID_ENABLED'],
  },
  schemaMarkup: {
    docsSlugs: ['schema-markup'],
    routePrefixes: ['/api/schema-generator'],
    flags: ['SCHEMA_GENERATOR_ENABLED'],
  },
  clientReports: {
    docsSlugs: ['client-reports'],
    routePrefixes: ['/api/client-reports', '/api/client-portal'],
    flags: ['CLIENT_REPORTS_ENABLED'],
  },
} as const;

describe('feature-truth manifest', () => {
  it('pins every community-request docs, route, and flag contract', () => {
    for (const key of Object.keys(COMMUNITY_ENTRY_CONTRACT) as Array<
      keyof typeof COMMUNITY_ENTRY_CONTRACT
    >) {
      const entry = FEATURE_TRUTH[key];
      expect(
        {
          docsSlugs: entry.docsSlugs,
          routePrefixes: entry.routePrefixes,
          flags: entry.flags,
        },
        key,
      ).toEqual(COMMUNITY_ENTRY_CONTRACT[key]);
    }
  });

  it('(b) state lists strictly equal the module-exported enums', () => {
    expect(FEATURE_TRUTH.audienceResearch.states).toEqual(AUDIENCE_RESEARCH_STATES);
    expect(FEATURE_TRUTH.keywordIntelligence.states).toEqual(
      KEYWORD_CLUSTER_DECISION_KINDS,
    );
    expect(FEATURE_TRUTH.nextActions.states).toEqual(ACTION_STATES);
    expect(FEATURE_TRUTH.confirmedRankAlerts.states).toEqual(
      RANK_DROP_CONFIRMATION_STATES,
    );
    expect(FEATURE_TRUTH.weeklyPulse.states).toEqual(WEEKLY_PULSE_RUN_STATUSES);
    expect(FEATURE_TRUTH.contentIntelligence.states).toEqual(
      CONTENT_ANALYSIS_STATUSES,
    );
    expect(FEATURE_TRUTH.contentInventory.states).toEqual(
      CONTENT_INVENTORY_STATUSES,
    );
    expect(FEATURE_TRUTH.competitorContent.states).toEqual(
      COMPETITOR_CONTENT_STATUSES,
    );
    expect(FEATURE_TRUTH.contentMonitoring.states).toEqual(
      CONTENT_MONITOR_STATUSES,
    );
    expect(FEATURE_TRUTH.linkIntelligence.states).toEqual(
      LINK_INTELLIGENCE_RUN_STATUSES,
    );
    expect(FEATURE_TRUTH.trafficInsights.states).toEqual(
      TRAFFIC_SNAPSHOT_RUN_STATUSES,
    );
    expect(FEATURE_TRUTH.keywordTrends.states).toEqual(
      TRENDS_EXPLORATION_STATUSES,
    );
    expect(FEATURE_TRUTH.reviewIntelligence.states).toEqual(
      REVIEW_SYNC_RUN_STATUSES,
    );
    expect(FEATURE_TRUTH.brandRadar.states).toEqual(
      BRAND_RADAR_SCAN_STATUSES,
    );
    // rankme-community-requests — spec 13 §8 / §15.
    expect(FEATURE_TRUTH.keywordClustering.states).toEqual(
      KEYWORD_CLUSTER_RUN_STATUSES,
    );
    expect(FEATURE_TRUTH.toxicLinks.states).toEqual(TOXICITY_REVIEW_STATUSES);
    expect(FEATURE_TRUTH.alerts.states).toEqual(ALERT_DELIVERY_STATUSES);
    expect(FEATURE_TRUTH.internalLinking.states).toEqual(
      INTERNAL_LINK_RUN_STATUSES,
    );
    expect(FEATURE_TRUTH.contentBriefs.states).toEqual(CONTENT_BRIEF_STATUSES);
    expect(FEATURE_TRUTH.geogrid.states).toEqual(GEOGRID_SCAN_STATUSES);
    expect(FEATURE_TRUTH.schemaMarkup.states).toEqual(
      SCHEMA_GENERATION_STATUSES,
    );
    expect(FEATURE_TRUTH.clientReports.states).toEqual(
      CLIENT_REPORT_DELIVERY_STATUSES,
    );
    // Stateless surfaces stay explicitly empty.
    expect(FEATURE_TRUTH.aiVisibilityCitations.states).toEqual([]);
    expect(FEATURE_TRUTH.publicExports.states).toEqual([]);
    expect(FEATURE_TRUTH.mcp.states).toEqual([]);
    expect(FEATURE_TRUTH.assistant.states).toEqual([]);
    expect(FEATURE_TRUTH.serpFeatureTracking.states).toEqual([]);
    expect(FEATURE_TRUTH.altEngineTracking.states).toEqual([]);
    expect(FEATURE_TRUTH.cannibalization.states).toEqual([]);
  });

  it('(c) every docsSlug is in the docs-integrity SLUGS catalog', () => {
    expect(integritySlugs.length).toBeGreaterThan(20);
    for (const [feature, entry] of ENTRIES) {
      for (const slug of entry.docsSlugs) {
        expect(integritySlugs, `${feature}: docs slug ${slug}`).toContain(slug);
      }
    }
  });

  it('(d) client docsUrl, seo.data, and gen-docs enumerate the same slug set', () => {
    const client = withoutIndex(clientSlugs);
    const gen = withoutIndex(genDocsSlugs);
    const seo = withoutIndex(SEO_DOCS_SLUGS);
    const integrity = withoutIndex(integritySlugs);
    expect(client).toEqual(integrity);
    expect(gen).toEqual(integrity);
    expect(seo).toEqual(integrity);
    // 'index' is present everywhere except the seo path inventory (which
    // models it as the bare /docs path instead of a slug).
    expect(clientSlugs).toContain('index');
    expect(genDocsSlugs).toContain('index');
    expect(SEO_DOCS_SLUGS).not.toContain('index');
  });

  it('(e) every flags entry is a kill-switch key or an env-schema key', () => {
    const envSource = read('server/src/config/env.ts');
    const envKeys = new Set(
      [...envSource.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map(
        (m) => m[1] as string,
      ),
    );
    expect(envKeys.has('MCP_ENABLED'), 'env schema parse sanity').toBe(true);
    for (const [feature, entry] of ENTRIES) {
      for (const flag of entry.flags) {
        const known =
          (FEATURE_FLAG_KEYS as readonly string[]).includes(flag) ||
          envKeys.has(flag);
        expect(known, `${feature}: flag ${flag} must be FEATURE_FLAG_KEYS or env key`).toBe(
          true,
        );
      }
    }
  });

  it('every routePrefix is a real app.ts mount', () => {
    const appSource = read('server/src/app.ts');
    for (const [feature, entry] of ENTRIES) {
      for (const prefix of entry.routePrefixes) {
        // Prettier may wrap `app.use(` onto its own line, so assert the
        // quoted prefix literal itself (mount strings are unique to app.use).
        expect(
          appSource.includes(`'${prefix}'`) || appSource.includes(`"${prefix}"`),
          `${feature}: app.ts mounts ${prefix}`,
        ).toBe(true);
      }
    }
  });

  it('every feature entry is fully populated (docsSlugs + routePrefixes)', () => {
    for (const [feature, entry] of ENTRIES) {
      expect(entry.docsSlugs.length, `${feature}: docsSlugs`).toBeGreaterThan(0);
      expect(entry.routePrefixes.length, `${feature}: routePrefixes`).toBeGreaterThan(0);
    }
  });
});
