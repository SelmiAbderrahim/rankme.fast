import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { runComposeCommand, runComposePsql, runComposePsqlOutput } from './compose';

export interface SeedPage {
  url: string;
  title?: string | null;
  isIndexable?: boolean;
  nonIndexableReason?: string | null;
  onPageScore?: number;
}

export interface SeedGscPage {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  query?: string;
}

export interface SeedFallbackKeyword {
  url: string;
  keyword: string;
  position: number;
  searchVolume: number | null;
  difficulty: number | null;
  estimatedTraffic: number | null;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const pageIdForUrl = (url: string): string =>
  createHash('sha256').update(url, 'utf8').digest('base64url');

function runComposeMongo(script: string, args: Record<string, unknown>): void {
  const wrapped = `const __args=${JSON.stringify(args)};${script}`;
  runComposeCommand([
    'exec',
    '-T',
    'mongo',
    'mongosh',
    '--quiet',
    'mongodb://mongo:27017/rankme',
    '--eval',
    wrapped,
  ]);
}

export function accountIdForEmail(email: string): string {
  const id = runComposePsqlOutput(
    `SELECT id FROM "user" WHERE email = :'email' LIMIT 1;`,
    { variables: { email } },
  );
  if (!/^[0-9a-f]{24}$/u.test(id)) throw new Error(`No E2E account for ${email}`);
  return id;
}

export function setProTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
       DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
    { variables: { account_id: accountId } },
  );
}

export function keywordUsage(accountId: string): number {
  const raw = runComposePsqlOutput(
    `SELECT coalesce(max(used), 0)
       FROM usage_counters
      WHERE account_id = :'account_id'
        AND period = to_char(now(), 'YYYY-MM')
        AND metric = 'keyword_lookups';`,
    { variables: { account_id: accountId } },
  );
  return Number(raw);
}

export function setKeywordUsage(accountId: string, used: number, limit: number): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
       VALUES (:'account_id', to_char(now(), 'YYYY-MM'), 'keyword_lookups', :'used', :'limit')
       ON CONFLICT (account_id, period, metric)
       DO UPDATE SET used = EXCLUDED.used, "limit" = EXCLUDED."limit", updated_at = now();`,
    {
      variables: {
        account_id: accountId,
        used: String(used),
        limit: String(limit),
      },
    },
  );
}

export function seedGoogleConnection(input: {
  accountId: string;
  propertyUrl: string | null;
  status?: 'connected' | 'needs_reconnect' | 'revoked';
}): void {
  runComposeMongo(
    `const dbx=db.getSiblingDB('rankme');
     dbx.googleconnections.deleteMany({accountId:ObjectId(__args.accountId)});
     dbx.googleconnections.insertOne({
       accountId:ObjectId(__args.accountId),
       googleAccountEmail:'fixture@rankme.test',
       encryptedRefreshToken:{ciphertext:'REDACTED_FIXTURE',iv:'REDACTED_FIXTURE',authTag:'REDACTED_FIXTURE',keyVersion:1},
       scopes:['https://www.googleapis.com/auth/webmasters.readonly'],
       status:__args.status,
       propertyUrl:__args.propertyUrl,
       ga4PropertyId:null,
       ga4PropertyDisplayName:null,
       connectedAt:new Date('2026-08-01T00:00:00.000Z'),
       lastUsedAt:null,
       createdAt:new Date('2026-08-01T00:00:00.000Z'),
       updatedAt:new Date('2026-08-01T00:00:00.000Z')
     });`,
    {
      accountId: input.accountId,
      propertyUrl: input.propertyUrl,
      status: input.status ?? 'connected',
    },
  );
}

export function bindSiteToGsc(input: {
  accountId: string;
  siteId: string;
  propertyUrl: string;
}): void {
  runComposeMongo(
    `db.getSiblingDB('rankme').sites.updateOne(
       {_id:ObjectId(__args.siteId),accountId:ObjectId(__args.accountId)},
       {$set:{gscPropertyUrl:__args.propertyUrl,gscBindingGenerationId:'legacy',gscBindingSource:'legacy'}}
     );`,
    input,
  );
}

export function clearGoogleConnection(accountId: string): void {
  runComposeMongo(
    `db.getSiblingDB('rankme').googleconnections.deleteMany({accountId:ObjectId(__args.accountId)});`,
    { accountId },
  );
}

export function seedAuditInventory(input: {
  accountId: string;
  siteId: string;
  pages: readonly SeedPage[];
}): void {
  const runId = randomBytes(12).toString('hex');
  const pages = input.pages.map((page) => ({
    runId,
    url: page.url,
    title: page.title ?? null,
    isIndexable: page.isIndexable ?? true,
    nonIndexableReason: page.nonIndexableReason ?? null,
    onPageScore: page.onPageScore ?? 80,
  }));
  runComposeMongo(
    `const dbx=db.getSiblingDB('rankme');
     dbx.auditruns.insertOne({
       _id:ObjectId(__args.runId),accountId:ObjectId(__args.accountId),siteId:ObjectId(__args.siteId),
       status:'succeeded',pageCap:100,trigger:'manual',kind:'site',targetUrl:null,targetDomain:null,
       startedAt:new Date('2026-08-01T00:00:00.000Z'),finishedAt:new Date('2026-08-01T00:01:00.000Z'),
       error:null,vendorTaskId:null,result:null,expiresAt:null,activeKey:null,
       createdAt:new Date('2026-08-01T00:00:00.000Z'),updatedAt:new Date('2026-08-01T00:01:00.000Z')
     });
     if(__args.pages.length){dbx.auditedpages.insertMany(__args.pages.map((page)=>({
       runId:ObjectId(page.runId),url:page.url,statusCode:200,title:page.title,metaDescription:null,
       h1:[],h2:[],canonical:null,hasStructuredData:false,structuredDataErrors:[],
       isIndexable:page.isIndexable,nonIndexableReason:page.nonIndexableReason,brokenLinks:[],
       onPageScore:page.onPageScore,timing:null,
       createdAt:new Date('2026-08-01T00:00:00.000Z'),updatedAt:new Date('2026-08-01T00:00:00.000Z')
     })));}`,
    { ...input, runId, pages },
  );
}

export function seedGscSnapshots(input: {
  accountId: string;
  siteId: string;
  pages: readonly SeedGscPage[];
  rangeDays?: 7 | 28 | 90;
  currentDate?: string;
  previousDate?: string;
}): void {
  const rangeDays = input.rangeDays ?? 28;
  const currentDate = input.currentDate ?? '2026-08-07';
  const previousDate = input.previousDate ?? '2026-08-01';
  const currentRows = input.pages.flatMap((page) => [
    {
      dimension_set: 'page',
      dimension_key: page.url,
      clicks: page.clicks,
      impressions: page.impressions,
      ctr: page.ctr,
      position: page.position,
    },
    ...(page.query === undefined ? [] : [{
      dimension_set: 'query,page',
      dimension_key: `${page.query}\u001f${page.url}`,
      clicks: page.clicks,
      impressions: page.impressions,
      ctr: page.ctr,
      position: page.position,
    }]),
  ]);
  const previousRows = input.pages.map((page) => ({
    dimension_set: 'page',
    dimension_key: page.url,
    clicks: Math.max(0, page.clicks - 5),
    impressions: Math.max(1, page.impressions - 50),
    ctr: Math.max(0, page.ctr - 0.01),
    position: page.position + 4,
  }));
  runComposePsql(
    `DELETE FROM gsc_search_analytics
      WHERE account_id = :'account_id' AND site_id = :'site_id' AND window_days = :'range_days';
     INSERT INTO gsc_search_analytics
       (account_id, site_id, binding_generation_id, snapshot_date, dimension_set, window_days, dimension_key,
        clicks, impressions, ctr, position, fetched_at)
     SELECT :'account_id', :'site_id', 'legacy', :'current_date'::date, row.dimension_set, :'range_days',
            row.dimension_key, row.clicks, row.impressions, row.ctr, row.position,
            '2026-08-10T00:00:00.000Z'::timestamptz
       FROM jsonb_to_recordset((:'current_rows')::jsonb)
         AS row(dimension_set text, dimension_key text, clicks integer, impressions integer,
                ctr real, position real);
     INSERT INTO gsc_search_analytics
       (account_id, site_id, binding_generation_id, snapshot_date, dimension_set, window_days, dimension_key,
        clicks, impressions, ctr, position, fetched_at)
     SELECT :'account_id', :'site_id', 'legacy', :'previous_date'::date, row.dimension_set, :'range_days',
            row.dimension_key, row.clicks, row.impressions, row.ctr, row.position,
            '2026-08-04T00:00:00.000Z'::timestamptz
       FROM jsonb_to_recordset((:'previous_rows')::jsonb)
         AS row(dimension_set text, dimension_key text, clicks integer, impressions integer,
                ctr real, position real);`,
    {
      variables: {
        account_id: input.accountId,
        site_id: input.siteId,
        range_days: String(rangeDays),
        current_date: currentDate,
        previous_date: previousDate,
        current_rows: JSON.stringify(currentRows),
        previous_rows: JSON.stringify(previousRows),
      },
    },
  );
}

export function seedGscSyncState(input: {
  accountId: string;
  siteId: string;
  propertyUrl: string;
  status: 'running' | 'empty' | 'failed';
  snapshotDate?: string | null;
}): void {
  runComposePsql(
    `DELETE FROM gsc_sync_runs WHERE account_id = :'account_id' AND site_id = :'site_id';
     INSERT INTO gsc_sync_runs
       (account_id, site_id, binding_generation_id, generation, property_url_hash, status, started_at, completed_at,
        snapshot_date, last_success_at, failure_class)
     VALUES
       (:'account_id', :'site_id', 'legacy', 1, :'property_hash', :'status',
        '2026-08-10T00:00:00.000Z',
        CASE WHEN :'status' = 'running' THEN NULL ELSE '2026-08-10T00:01:00.000Z'::timestamptz END,
        nullif(:'snapshot_date', '')::date,
        CASE WHEN :'status' = 'empty' THEN '2026-08-10T00:01:00.000Z'::timestamptz ELSE NULL END,
        CASE WHEN :'status' = 'failed' THEN 'VendorUnavailableError' ELSE NULL END);`,
    {
      variables: {
        account_id: input.accountId,
        site_id: input.siteId,
        property_hash: sha256(input.propertyUrl),
        status: input.status,
        snapshot_date: input.snapshotDate ?? '',
      },
    },
  );
}

export function seedFallbackSnapshots(input: {
  accountId: string;
  siteId: string;
  rows: readonly SeedFallbackKeyword[];
  source?: 'demo' | 'dataforseo';
  stale?: boolean;
}): void {
  const source = input.source ?? 'demo';
  const snapshotId = randomUUID();
  const previousId = randomUUID();
  const observedAt = input.stale ? '2025-01-10T00:00:00.000Z' : '2026-08-10T00:00:00.000Z';
  const cacheFetchedAt = input.stale ? '2025-01-10T00:00:00.000Z' : '2026-08-10T00:00:00.000Z';
  const previousObservedAt = input.stale
    ? '2025-01-04T00:00:00.000Z'
    : '2026-08-04T00:00:00.000Z';
  const rows = input.rows.map((row) => ({
    ...row,
    pageHash: pageIdForUrl(row.url),
    displayUrl: new URL(row.url).pathname || '/',
  }));
  const previousRows = rows.map((row) => ({ ...row, position: row.position + 4 }));
  runComposePsql(
    `DELETE FROM page_performance_snapshots WHERE account_id = :'account_id' AND site_id = :'site_id';
     INSERT INTO page_performance_snapshots
       (id, account_id, site_id, source, location_code, language_code, observed_at,
        cache_fetched_at, cache_status, successful_empty, payload_fingerprint,
        source_rows_fetched, accepted_count, dropped_count, malformed_url_count,
        offsite_url_count, duplicate_url_count, invalid_metric_count, source_truncated)
     VALUES
       (:'previous_id', :'account_id', :'site_id', :'source', 2840, 'en',
        :'previous_observed_at', :'previous_observed_at', 'miss', false,
        :'previous_fingerprint', :'row_count', :'row_count', 0, 0, 0, 0, 0, false),
       (:'snapshot_id', :'account_id', :'site_id', :'source', 2840, 'en',
        :'observed_at', :'cache_fetched_at', 'hit', false, :'fingerprint',
        :'row_count', :'row_count', 0, 0, 0, 0, 0, false);
     INSERT INTO page_performance_keywords
       (snapshot_id, account_id, site_id, page_hash, canonical_url, display_url, keyword,
        position, search_volume, difficulty, estimated_traffic)
     SELECT :'snapshot_id', :'account_id', :'site_id', row.page_hash, row.url, row.display_url,
            row.keyword, row.position, row.search_volume, row.difficulty, row.estimated_traffic
       FROM jsonb_to_recordset((:'rows')::jsonb)
         AS row(page_hash text, url text, display_url text, keyword text, position double precision,
                search_volume integer, difficulty double precision, estimated_traffic double precision);
     INSERT INTO page_performance_keywords
       (snapshot_id, account_id, site_id, page_hash, canonical_url, display_url, keyword,
        position, search_volume, difficulty, estimated_traffic)
     SELECT :'previous_id', :'account_id', :'site_id', row.page_hash, row.url, row.display_url,
            row.keyword, row.position, row.search_volume, row.difficulty, row.estimated_traffic
       FROM jsonb_to_recordset((:'previous_rows')::jsonb)
         AS row(page_hash text, url text, display_url text, keyword text, position double precision,
                search_volume integer, difficulty double precision, estimated_traffic double precision);`,
    {
      variables: {
        account_id: input.accountId,
        site_id: input.siteId,
        source,
        snapshot_id: snapshotId,
        previous_id: previousId,
        observed_at: observedAt,
        cache_fetched_at: cacheFetchedAt,
        previous_observed_at: previousObservedAt,
        fingerprint: sha256(`${snapshotId}:current`),
        previous_fingerprint: sha256(`${previousId}:previous`),
        row_count: String(rows.length),
        rows: JSON.stringify(rows.map((row) => ({
          page_hash: row.pageHash,
          url: row.url,
          display_url: row.displayUrl,
          keyword: row.keyword,
          position: row.position,
          search_volume: row.searchVolume,
          difficulty: row.difficulty,
          estimated_traffic: row.estimatedTraffic,
        }))),
        previous_rows: JSON.stringify(previousRows.map((row) => ({
          page_hash: row.pageHash,
          url: row.url,
          display_url: row.displayUrl,
          keyword: row.keyword,
          position: row.position,
          search_volume: row.searchVolume,
          difficulty: row.difficulty,
          estimated_traffic: row.estimatedTraffic,
        }))),
      },
    },
  );
}
