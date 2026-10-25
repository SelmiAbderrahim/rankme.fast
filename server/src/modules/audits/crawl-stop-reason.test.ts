import { describe, expect, it } from 'vitest';
import { finalStopReason, readStopReason } from './crawl-stop-reason.js';

describe('finalStopReason — every new run records one', () => {
  it('keeps the crawler’s own reason', () => {
    expect(finalStopReason({ reported: 'crawler_error', pageCap: 10, pagesCrawled: 10 })).toBe('crawler_error');
  });

  it('derives page_limit at the cap and finished_below_limit under it', () => {
    expect(finalStopReason({ reported: undefined, pageCap: 100, pagesCrawled: 100 })).toBe('page_limit');
    expect(finalStopReason({ reported: undefined, pageCap: 100, pagesCrawled: 140 })).toBe('page_limit');
    expect(finalStopReason({ reported: undefined, pageCap: 100, pagesCrawled: 99 })).toBe('finished_below_limit');
  });
});

describe('readStopReason — read-time derivation for older runs', () => {
  it('returns a stored reason as recorded', () => {
    expect(readStopReason({ pageCap: 100, pagesCrawled: 3, crawlStopReason: 'no_more_links' })).toEqual({
      stopReason: 'no_more_links',
      stopReasonSource: 'recorded',
    });
  });

  it('derives page_limit when the stored counts reached the cap', () => {
    expect(readStopReason({ pageCap: 100, pagesCrawled: 100, crawlStopReason: null })).toEqual({
      stopReason: 'page_limit',
      stopReasonSource: 'derived',
    });
    expect(readStopReason({ pageCap: 100, pagesCrawled: 60, vendorPagesCrawled: 100 })).toEqual({
      stopReason: 'page_limit',
      stopReasonSource: 'derived',
    });
  });

  it('says nothing below the cap, with no count, or with no cap', () => {
    const none = { stopReason: null, stopReasonSource: null };
    expect(readStopReason({ pageCap: 100, pagesCrawled: 40 })).toEqual(none);
    expect(readStopReason({ pageCap: 100, pagesCrawled: null, vendorPagesCrawled: null })).toEqual(none);
    expect(readStopReason({ pageCap: 100 })).toEqual(none);
    expect(readStopReason({ pageCap: 0, pagesCrawled: 0 })).toEqual(none);
  });
});
