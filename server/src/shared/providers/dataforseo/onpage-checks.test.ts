import { describe, expect, it } from 'vitest';
import { normalizeDeepPageFields } from './onpage-checks.js';

describe('deep crawl page normalization', () => {
  it('inverts pass phrased URL checks and retains only measured facts', () => {
    expect(normalizeDeepPageFields({ status_code: 200, click_depth: 2.6, size: 1024,
      content_encoding: 'BR', page_timing: { waiting_time: 812.4 },
      duplicate_content: true,
      checks: { seo_friendly_url_dynamic_check: false, no_image_alt: true, no_doctype: null },
      meta: { inbound_links_count: 4, social_media_tags: { 'og:title': 'Example' } },
    })).toMatchObject({ clickDepth: 3, pageSizeBytes: 1024, contentEncoding: 'br',
      serverResponseMs: 812, inboundInternalLinks: 4,
      checks: { urlHasParameters: true, imagesMissingAlt: true, duplicateContent: true },
      socialTags: { openGraph: true, twitterCard: false } });
  });

  it('does not infer missing or body facts from an unreadable page', () => {
    expect(normalizeDeepPageFields({ status_code: 301, click_depth: 1,
      checks: { is_redirect: true }, meta: { images_count: 9 }, size: 20 })).toEqual({
      clickDepth: 1, checks: { redirects: true },
    });
    expect(normalizeDeepPageFields({ status_code: 200 })).toEqual({});
    expect(normalizeDeepPageFields({ status_code: 200, checks: { no_doctype: 'yes' } })).toEqual({});
  });
});
