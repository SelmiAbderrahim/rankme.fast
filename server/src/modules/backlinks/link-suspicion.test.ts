import { describe, expect, it } from 'vitest';
import {
  SHARED_TEMPLATE_MIN_DOMAINS,
  VENDOR_SPAM_SCORE_SUSPECT_AT,
  assessLinkSuspicion,
  isLookalikeDomain,
  pathTemplate,
} from './link-suspicion.js';

const row = (urlFrom: string, backlinkSpamScore?: number | null) => ({ urlFrom, backlinkSpamScore });

describe('pathTemplate', () => {
  it('replaces digit runs so templated pages share one shape', () => {
    expect(pathTemplate('/list/2026-07-24-247')).toBe('/list/#-#-#-#');
    expect(pathTemplate('/about')).toBe('/about');
  });
});

describe('isLookalikeDomain', () => {
  it('needs a hyphenated commerce name on a low-trust TLD', () => {
    expect(isLookalikeDomain('pandorajewelry-officialsites.us')).toBe(true);
    expect(isLookalikeDomain('www.cheap-bags-sale.xyz')).toBe(true);
    // False-positive guards: each part alone is ordinary.
    expect(isLookalikeDomain('official-sites.org')).toBe(false);
    expect(isLookalikeDomain('officialsites.us')).toBe(false);
    expect(isLookalikeDomain('my-blog.us')).toBe(false);
    expect(isLookalikeDomain('localhost')).toBe(false);
    expect(isLookalikeDomain('')).toBe(false);
  });
});

describe('assessLinkSuspicion', () => {
  const spamPage = (host: string, serial: number) => row(`https://${host}/list/2026-07-24-${serial}`);

  it('flags the reported templated pattern with every reason that applies', () => {
    const [first, second, third] = assessLinkSuspicion([
      spamPage('pandorajewelry-officialsites.us', 247),
      spamPage('pandorajewelry-outlet-store.top', 248),
      spamPage('plain-name.example', 249),
    ]);
    expect(first).toEqual({
      status: 'suspected',
      verified: false,
      reasons: ['dated_numbered_path', 'shared_path_template', 'lookalike_domain'],
    });
    expect(second?.reasons).toEqual(['dated_numbered_path', 'shared_path_template', 'lookalike_domain']);
    // Dated slug + shared template are two independent patterns, so it is flagged too.
    expect(third?.reasons).toEqual(['dated_numbered_path', 'shared_path_template']);
  });

  it('does not flag one pattern on its own', () => {
    const result = assessLinkSuspicion([
      row('https://news.example.org/posts/2026-07-24-7'),
      row('https://shop.example.com/'),
      row('https://official-store.us/'),
      row('https://blog.example.net/2026/07/24/launch'),
      row('not a url'),
    ]);
    expect(result).toEqual([null, null, null, null, null]);
  });

  it('needs the shared template on enough distinct registrable domains', () => {
    const sameDomain = assessLinkSuspicion([
      row('https://a.shared.example/p/2026-07-24-1'),
      row('https://b.shared.example/p/2026-07-24-2'),
      row('https://c.shared.example/p/2026-07-24-3'),
    ]);
    // One registrable domain: the template is not shared across referrers, and
    // the dated slug alone is a single pattern.
    expect(sameDomain).toEqual([null, null, null]);
    expect(SHARED_TEMPLATE_MIN_DOMAINS).toBe(3);
    // Short digit templates (a page number, a year) are not distinctive enough.
    const shortTemplate = assessLinkSuspicion([
      row('https://a.example/page/1'),
      row('https://b.example/page/2'),
      row('https://c.example/page/3'),
    ]);
    expect(shortTemplate).toEqual([null, null, null]);
  });

  it('flags a high provider spam score alone, at exactly the threshold', () => {
    const [atThreshold, below, missing] = assessLinkSuspicion([
      row('https://a.example/', VENDOR_SPAM_SCORE_SUSPECT_AT),
      row('https://b.example/', VENDOR_SPAM_SCORE_SUSPECT_AT - 1),
      row('https://c.example/', null),
    ]);
    expect(atThreshold).toEqual({ status: 'suspected', verified: false, reasons: ['vendor_spam_score'] });
    expect(below).toBeNull();
    expect(missing).toBeNull();
  });

  it('returns one entry per row and never marks a flag as verified', () => {
    expect(assessLinkSuspicion([])).toEqual([]);
    const flagged = assessLinkSuspicion([row('https://a.example/', 90)])[0];
    expect(flagged?.verified).toBe(false);
  });
});
