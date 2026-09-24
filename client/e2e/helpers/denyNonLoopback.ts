/**
 * Network egress deny-list for Playwright browser contexts.
 *
 * The composed E2E stack MUST stay on the loopback web origin. Any browser
 * request outside that origin — a leaked marketing tracker, an accidental
 * `<script src="https://cdn…">`, or a vendor API call that slipped past the
 * provider fake — is a hard failure, never a silent pass. Provider adapters
 * assert zero real network from the server side separately (contract tests
 * under `server/src/shared/providers/**`); this guard covers the browser
 * side.
 */
import type { BrowserContext, Request, Route } from '@playwright/test';

export interface EgressGuardOptions {
  /** Additional loopback origins to allow (defaults include 127.0.0.1 and localhost with any port). */
  extraAllowedOrigins?: string[];
  /** Called with each blocked URL before the request is aborted; lets callers assert failure. */
  onDeny?: (info: { url: string; method: string; resourceType: string }) => void;
}

/**
 * Origins that count as "the application under test" — every URL scheme
 * whose host resolves to loopback and matches the configured web port.
 * `blob:` and `data:` are inline resources, never external egress.
 */
function isLoopbackHost(host: string): boolean {
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (host === 'localhost') return true;
  return false;
}

function normalizeAllowedOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function denyNonLoopback(
  context: BrowserContext,
  options: EgressGuardOptions = {},
): Promise<void> {
  const extra = (options.extraAllowedOrigins ?? [])
    .map(normalizeAllowedOrigin)
    .filter((value): value is string => value !== null);
  const allowedOrigins = new Set(extra);
  return context.route('**/*', async (route: Route, request: Request) => {
    const url = request.url();
    // Playwright fires internal `about:` navigations we never want to block.
    if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    const origin = `${parsed.protocol}//${parsed.host}`;
    const host = parsed.hostname;
    const isAllowed = isLoopbackHost(host) || allowedOrigins.has(origin);
    if (isAllowed) {
      await route.continue();
      return;
    }
    options.onDeny?.({ url, method: request.method(), resourceType: request.resourceType() });
    await route.abort('blockedbyclient');
  });
}

/**
 * Convenience matcher for use in journey specs:
 * ```ts
 * const denials: string[] = [];
 * await denyNonLoopback(context, { onDeny: (info) => denials.push(info.url) });
 * ...run journey...
 * expect(denials, 'no external egress').toEqual([]);
 * ```
 */
export function collectDenials(): {
  urls: string[];
  onDeny: NonNullable<EgressGuardOptions['onDeny']>;
} {
  const urls: string[] = [];
  return {
    urls,
    onDeny: (info) => {
      urls.push(info.url);
    },
  };
}
