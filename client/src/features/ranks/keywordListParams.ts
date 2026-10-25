import { KEYWORD_PAGE_SIZES, RANK_ENGINES, type KeywordListQuery, type KeywordPageSize, type RankEngine } from './types';

export const KEYWORD_SEARCH_MAX = 300;
export const DEFAULT_KEYWORD_PAGE_SIZE: KeywordPageSize = KEYWORD_PAGE_SIZES[0];

/** Keep list state in the URL so a reload, Back, or shared link restores it. */
export function readKeywordListQuery(params: URLSearchParams): KeywordListQuery {
  const rawPage = params.get('page') ?? '';
  const parsedPage = /^\d+$/.test(rawPage) ? Number(rawPage) : 0;
  const parsedSize = Number(params.get('pageSize'));
  const rawEngine = params.get('engine');
  return {
    page: Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    pageSize: (KEYWORD_PAGE_SIZES as readonly number[]).includes(parsedSize)
      ? parsedSize as KeywordPageSize : DEFAULT_KEYWORD_PAGE_SIZE,
    engine: rawEngine !== null && (RANK_ENGINES as readonly string[]).includes(rawEngine)
      ? rawEngine as RankEngine : null,
    search: (params.get('search') ?? '').trim().slice(0, KEYWORD_SEARCH_MAX),
  };
}

export function writeKeywordListQuery(params: URLSearchParams, query: KeywordListQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => {
    if (value === null) next.delete(key);
    else next.set(key, value);
  };
  set('page', query.page > 1 ? String(query.page) : null);
  set('pageSize', query.pageSize !== DEFAULT_KEYWORD_PAGE_SIZE ? String(query.pageSize) : null);
  set('engine', query.engine);
  set('search', query.search || null);
  return next;
}

export const sameKeywordListQuery = (a: KeywordListQuery, b: KeywordListQuery): boolean =>
  a.page === b.page && a.pageSize === b.pageSize && a.engine === b.engine && a.search === b.search;

export const keywordPageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));

/** Show the ends and current neighbours; a lone hidden page is shown directly. */
export function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const shown = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...shown].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  for (const value of pages) {
    const previous = result.at(-1);
    if (typeof previous === 'number' && value - previous === 2) result.push(value - 1);
    else if (typeof previous === 'number' && value - previous > 2) result.push('gap');
    result.push(value);
  }
  return result;
}
