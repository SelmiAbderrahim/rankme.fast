import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { toCsv, type CsvColumn } from '../../shared/utils/csv.js';
import { HttpError } from '../../shared/utils/http-error.js';
export const V1_SITES_CSV_COLUMNS: CsvColumn[] = [
    { key: 'id', header: 'id' },
    { key: 'domain', header: 'domain' },
    { key: 'url', header: 'url' },
    { key: 'paused', header: 'paused' },
    { key: 'created_at', header: 'created_at' },
];
export const V1_RANK_HISTORY_CSV_COLUMNS: CsvColumn[] = [
    { key: 'keyword_id', header: 'keyword_id' },
    { key: 'phrase', header: 'phrase' },
    { key: 'engine', header: 'engine' },
    { key: 'checked_at', header: 'checked_at' },
    { key: 'position', header: 'position' },
    { key: 'rank_absolute', header: 'rank_absolute' },
    { key: 'source', header: 'source' },
    { key: 'found_url', header: 'found_url' },
    { key: 'ai_overview_present', header: 'ai_overview_present' },
    { key: 'ai_cited', header: 'ai_cited' },
    { key: 'ai_cited_url', header: 'ai_cited_url' },
];
export const V1_KEYWORDS_CSV_COLUMNS: CsvColumn[] = [
    { key: 'id', header: 'id' },
    { key: 'site_id', header: 'site_id' },
    { key: 'phrase', header: 'phrase' },
    { key: 'location_code', header: 'location_code' },
    { key: 'language_code', header: 'language_code' },
    { key: 'device', header: 'device' },
    { key: 'active', header: 'active' },
    { key: 'created_at', header: 'created_at' },
    { key: 'updated_at', header: 'updated_at' },
    { key: 'latest_position', header: 'latest_position' },
    { key: 'previous_position', header: 'previous_position' },
    { key: 'delta', header: 'delta' },
    { key: 'last_checked_at', header: 'last_checked_at' },
    { key: 'ai_overview_present', header: 'ai_overview_present' },
    { key: 'ai_cited', header: 'ai_cited' },
    { key: 'ai_cited_url', header: 'ai_cited_url' },
    { key: 'track_local_pack', header: 'track_local_pack' },
    { key: 'last_failed_check_at', header: 'last_failed_check_at' },
    { key: 'last_failed_reason', header: 'last_failed_reason' },
    { key: 'engine', header: 'engine' },
    { key: 'engine_target', header: 'engine_target' },
];
export const V1_SERP_FEATURES_CSV_COLUMNS: CsvColumn[] = [
    { key: 'id', header: 'id' },
    { key: 'site_id', header: 'site_id' },
    { key: 'keyword_id', header: 'keyword_id' },
    { key: 'engine', header: 'engine' },
    { key: 'checked_at', header: 'checked_at' },
    { key: 'source', header: 'source' },
    { key: 'features_json', header: 'features_json' },
    { key: 'top_results_json', header: 'top_results_json' },
    { key: 'created_at', header: 'created_at' },
    { key: 'source_kind', header: 'source_kind' },
];
export const V1_BACKLINK_ROWS_CSV_COLUMNS: CsvColumn[] = [
    { key: 'id', header: 'id' },
    { key: 'review_id', header: 'review_id' },
    { key: 'site_id', header: 'site_id' },
    { key: 'url', header: 'url' },
    { key: 'domain', header: 'domain' },
    { key: 'spam_score', header: 'spam_score' },
    { key: 'rubric_band', header: 'rubric_band' },
    { key: 'rubric_version', header: 'rubric_version' },
    { key: 'first_seen', header: 'first_seen' },
    { key: 'last_seen', header: 'last_seen' },
    { key: 'dofollow', header: 'dofollow' },
    { key: 'is_broken', header: 'is_broken' },
    { key: 'rationale', header: 'rationale' },
    { key: 'rationale_status', header: 'rationale_status' },
    { key: 'captured_at', header: 'captured_at' },
    { key: 'source_kind', header: 'source_kind' },
];
export const V1_CSV_CONTRACTS = {
    sites: V1_SITES_CSV_COLUMNS,
    rankHistory: V1_RANK_HISTORY_CSV_COLUMNS,
    keywords: V1_KEYWORDS_CSV_COLUMNS,
    serpFeatures: V1_SERP_FEATURES_CSV_COLUMNS,
    backlinkRows: V1_BACKLINK_ROWS_CSV_COLUMNS,
} as const;
/** Explicit CSV requests only; an ordinary wildcard Accept header remains JSON. */
export function wantsV1Csv(req: Request, format?: 'csv'): boolean {
    if (format === 'csv')
        return true;
    const accept = req.get('accept');
    return (typeof accept === 'string' &&
        /(?:^|,)\s*text\/csv(?:\s*;|\s*(?:,|$))/i.test(accept) &&
        req.accepts('text/csv') === 'text/csv');
}
export function assertPublicExportsEnabled(): void {
    if (!env.PUBLIC_EXPORTS_ENABLED) {
        throw new HttpError(503, { code: 'PUBLIC_API_ERRORS_EXPORTS_UNAVAILABLE', messageKey: 'publicApi.errors.exportsUnavailable' });
    }
}
export function sendV1Csv(res: Response, filename: string, rows: readonly Record<string, unknown>[], columns: CsvColumn[], nextCursor?: string | null): void {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    if (nextCursor)
        res.set('X-Next-Cursor', nextCursor);
    res.status(200).send(toCsv(rows, columns));
}
