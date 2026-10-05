/**
 * A small, dependency-free user-agent reader for the Active sessions list.
 * It only names the common browsers and operating systems; anything it does
 * not recognise yields `null` fields so the caller can fall back to the raw
 * string. Names are proper nouns and stay untranslated.
 */
export interface ParsedUserAgent {
  /** e.g. "Chrome 154" — major version only. */
  browser: string | null;
  /** e.g. "macOS". */
  os: string | null;
}

/** Order matters: Chromium forks and iOS wrappers also carry "Chrome/" or "Safari/". */
const BROWSERS: ReadonlyArray<{ name: string; token: RegExp }> = [
  { name: 'Edge', token: /\b(?:Edg|EdgA|EdgiOS|Edge)\/(\d+)/ },
  { name: 'Opera', token: /\b(?:OPR|OPiOS)\/(\d+)/ },
  { name: 'Samsung Internet', token: /\bSamsungBrowser\/(\d+)/ },
  { name: 'Firefox', token: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', token: /\b(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Safari', token: /\bVersion\/(\d+)[^)]*\bSafari\// },
];

/** Order matters: iPhone/iPad UAs say "like Mac OS X" and Android UAs say "Linux". */
const SYSTEMS: ReadonlyArray<{ name: string; token: RegExp }> = [
  { name: 'iOS', token: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: 'Android', token: /\bAndroid\b/ },
  { name: 'Windows', token: /\bWindows\b/ },
  { name: 'macOS', token: /\bMacintosh\b|\bMac OS X\b/ },
  { name: 'ChromeOS', token: /\bCrOS\b/ },
  { name: 'Linux', token: /\bLinux\b|\bX11\b/ },
];

export const parseUserAgent = (userAgent: string): ParsedUserAgent => {
  let browser: string | null = null;
  for (const candidate of BROWSERS) {
    const match = candidate.token.exec(userAgent);
    if (match) {
      browser = `${candidate.name} ${match[1]}`;
      break;
    }
  }
  const os = SYSTEMS.find((candidate) => candidate.token.test(userAgent))?.name ?? null;
  return { browser, os };
};
