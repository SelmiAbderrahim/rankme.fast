import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './userAgent';

const CASES: ReadonlyArray<[string, string, string | null, string | null]> = [
  [
    'Chrome on macOS',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
    'Chrome 154',
    'macOS',
  ],
  [
    'Edge on Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.46',
    'Edge 130',
    'Windows',
  ],
  [
    'Firefox on Linux',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Firefox 131',
    'Linux',
  ],
  [
    'Safari on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Safari 17',
    'iOS',
  ],
  [
    'Chrome on iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
    'Chrome 126',
    'iOS',
  ],
  [
    'Samsung Internet on Android',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    'Samsung Internet 25',
    'Android',
  ],
  [
    'Opera on ChromeOS',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
    'Opera 115',
    'ChromeOS',
  ],
  [
    'desktop Safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Safari 17',
    'macOS',
  ],
];

describe('parseUserAgent', () => {
  it.each(CASES)('reads %s', (_label, ua, browser, os) => {
    expect(parseUserAgent(ua)).toEqual({ browser, os });
  });

  it('returns nulls for an unrecognised agent', () => {
    expect(parseUserAgent('curl/8.4.0')).toEqual({ browser: null, os: null });
  });
});
