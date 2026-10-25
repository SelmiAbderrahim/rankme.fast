import { beforeAll, describe, expect, it } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { crawlEvidenceLines, crawlStateLabel } from './crawlState';
import type { CrawlEvidence, CrawlState, PageRow } from './types';

beforeAll(async () => {
  await initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const t = i18n.getFixedT('en', 'pages');

const evidence = (patch: Partial<CrawlEvidence> = {}): CrawlEvidence => ({
  source: 'crawl',
  statusCode: 200,
  finalUrl: null,
  redirectChain: [],
  contentType: 'text/html',
  failure: null,
  nonIndexableReason: null,
  ...patch,
});

const row = (
  crawlState: CrawlState,
  crawlEvidence: CrawlEvidence | null = null,
  crawledAs?: string,
): Pick<PageRow, 'crawlState' | 'crawlEvidence' | 'crawledAs'> => ({
  crawlState,
  crawlEvidence,
  ...(crawledAs ? { crawledAs } : {}),
});

describe('crawlStateLabel', () => {
  it.each([
    ['indexable', 'Crawl-indexable'],
    ['non_indexable', 'Not crawl-indexable'],
    ['failed', 'Could not be read'],
    ['not_in_crawl', 'Not in the last crawl'],
    ['no_crawl', 'No crawl yet'],
  ] as const)('words %s', (state, label) => {
    expect(crawlStateLabel(t, row(state))).toBe(label);
  });

  it('names the redirect target, from the evidence', () => {
    expect(
      crawlStateLabel(t, row('redirected', evidence({ finalUrl: 'https://example.com/en?x=1' }))),
    ).toBe('Redirects to /en?x=1');
    expect(crawlStateLabel(t, row('redirected', evidence({ finalUrl: 'not a url' })))).toBe(
      'Redirects to not a url',
    );
    expect(crawlStateLabel(t, row('redirected'))).toBe('Redirects to ');
  });

  it('prefers the crawled page a URL leads to', () => {
    expect(crawlStateLabel(t, row('not_in_crawl', null, 'example.com/en/pricing'))).toBe(
      'Crawled as /en/pricing',
    );
    expect(
      crawlStateLabel(t, row('redirected', evidence({ finalUrl: 'https://example.com/en' }), 'example.com/en')),
    ).toBe('Crawled as /en');
    // A crawled twin never relabels a page that failed or is excluded.
    expect(crawlStateLabel(t, row('failed', null, 'example.com/en'))).toBe('Could not be read');
  });
});

describe('crawlEvidenceLines', () => {
  it('asks for an audit when there is no crawl, and says nothing was recorded when a URL is simply missing', () => {
    expect(crawlEvidenceLines(t, row('no_crawl'))).toEqual(['Run an audit to see how this address crawls.']);
    expect(crawlEvidenceLines(t, row('not_in_crawl'))).toEqual([
      'The audit did not record why this address is missing.',
    ]);
  });

  it('adds nothing for a plain healthy row with no recorded detail', () => {
    expect(crawlEvidenceLines(t, row('indexable'))).toEqual([]);
    expect(crawlEvidenceLines(t, row('indexable', evidence()))).toEqual(['Recorded by the audit crawl.']);
  });

  it('shows the redirect: final address, the path taken, and where it was checked', () => {
    expect(
      crawlEvidenceLines(
        t,
        row(
          'redirected',
          evidence({
            source: 'probe',
            finalUrl: 'https://example.com/en',
            redirectChain: [
              { url: 'https://example.com/', status: 301 },
              { url: 'https://example.com/home', status: 302 },
            ],
          }),
        ),
      ),
    ).toEqual([
      'HTTP status: 200',
      'Final address: https://example.com/en',
      'Redirect path: 301 / → 302 /home',
      'Checked directly while the audit ran.',
    ]);
  });

  it.each([
    [{ kind: 'http_error', statusCode: 404 }, 'The page answered HTTP 404.'],
    [{ kind: 'redirect_loop' }, 'Its redirects loop back on themselves.'],
    [{ kind: 'redirect_limit' }, 'It redirects more than five times, so we stopped following.'],
    [{ kind: 'unsafe_redirect' }, 'It redirects to an address we do not follow.'],
    [{ kind: 'robots_blocked' }, 'robots.txt tells crawlers to skip this page.'],
    [{ kind: 'timeout' }, 'The page did not answer in time.'],
    [{ kind: 'non_html', contentType: 'application/pdf' }, 'This address serves application/pdf, not a web page.'],
    [{ kind: 'unreachable' }, 'We could not connect to this address.'],
  ] as const)('explains %j', (failure, sentence) => {
    expect(crawlEvidenceLines(t, row('failed', evidence({ failure, statusCode: null })))[0]).toBe(sentence);
  });

  it.each([401, 403, 429])('adds the bot-protection hint for HTTP %i only', (statusCode) => {
    const lines = crawlEvidenceLines(
      t,
      row('failed', evidence({ failure: { kind: 'http_error', statusCode }, statusCode })),
    );
    expect(lines[1]).toBe(
      'Some sites answer automated visits with this status. Check that the page opens in a normal browser window.',
    );
    const notBlocked = crawlEvidenceLines(
      t,
      row('failed', evidence({ failure: { kind: 'http_error', statusCode: 404 }, statusCode: 404 })),
    );
    expect(notBlocked.some((line) => line.includes('Some sites answer'))).toBe(false);
  });

  it('falls back to the evidence status and media type when the failure carries none', () => {
    expect(
      crawlEvidenceLines(t, row('failed', evidence({ failure: { kind: 'http_error' }, statusCode: 503 })))[0],
    ).toBe('The page answered HTTP 503.');
    expect(
      crawlEvidenceLines(t, row('failed', evidence({ failure: { kind: 'non_html' }, contentType: 'image/png' })))[0],
    ).toBe('This address serves image/png, not a web page.');
    expect(
      crawlEvidenceLines(t, row('failed', evidence({ failure: { kind: 'http_error' }, statusCode: null, contentType: null })))[0],
    ).toBe('The page answered HTTP .');
  });

  it('states the HTTP status of an excluded or redirected row that has no failure', () => {
    expect(
      crawlEvidenceLines(t, row('non_indexable', evidence({ statusCode: 200, nonIndexableReason: 'meta_tag' }))),
    ).toEqual(['HTTP status: 200', 'Recorded by the audit crawl.']);
    expect(crawlEvidenceLines(t, row('non_indexable', evidence({ statusCode: null })))).toEqual([
      'Recorded by the audit crawl.',
    ]);
  });

  it('keeps the redirect lines out when the chain is empty', () => {
    expect(
      crawlEvidenceLines(t, row('redirected', evidence({ finalUrl: 'https://example.com/en', statusCode: 301 }))),
    ).toEqual(['HTTP status: 301', 'Recorded by the audit crawl.']);
  });
});

describe('crawlStateLabel — proven redirect sources', () => {
  it('names the listed page a redirect source leads to, before any twin wording', () => {
    expect(
      crawlStateLabel(t, {
        crawlState: 'redirected',
        crawlEvidence: null,
        crawledAs: 'example.com/en/episode-pass',
        redirectsTo: 'example.com/en/episode-pass',
      }),
    ).toBe('Redirects to /en/episode-pass');
  });
});
