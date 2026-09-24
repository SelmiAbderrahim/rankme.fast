import { describe, expect, it } from 'vitest';
import {
  FIRECRAWL_SIGNATURE_HEADER,
  MonitorWebhookVerifyError,
  signMonitorWebhookBody,
  verifyMonitorWebhookSignature,
} from './webhook.verify.js';

const PRIMARY = 'primary-secret-value';
const PREVIOUS = 'previous-secret-value';
const RETIRED = 'retired-secret-value';
const PRIMARY_REF = 'fc-cred-v1:primary';
const FALLBACK_REF = 'fc-cred-v1:fallback';
const rawBody = Buffer.from(JSON.stringify({ type: 'monitor.page', data: [] }), 'utf8');
const primaryBindings = [{ secret: PRIMARY, credentialRef: PRIMARY_REF }];

function headers(sig: string | string[]): Record<string, string | string[]> {
  return { 'x-firecrawl-signature': sig, 'content-type': 'application/json' };
}

function expectStatus(fn: () => unknown, status: number): void {
  try {
    fn();
    throw new Error('expected verification to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(MonitorWebhookVerifyError);
    expect((err as MonitorWebhookVerifyError).status).toBe(status);
  }
}

describe('verifyMonitorWebhookSignature', () => {
  it('accepts a valid signature and returns its bound credential', () => {
    const sig = signMonitorWebhookBody(rawBody, PRIMARY);
    expect(
      verifyMonitorWebhookSignature({ rawBody, headers: headers(sig), bindings: primaryBindings }),
    ).toBe(PRIMARY_REF);
  });

  it('rejects a one-byte body mutation', () => {
    const sig = signMonitorWebhookBody(rawBody, PRIMARY);
    const tampered = Buffer.from(rawBody);
    tampered[0] = tampered[0]! ^ 0x01;
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody: tampered,
          headers: headers(sig),
          bindings: primaryBindings,
        }),
      401,
    );
  });

  it('rejects a signature computed with the wrong secret', () => {
    const sig = signMonitorWebhookBody(rawBody, 'attacker-secret');
    expectStatus(
      () => verifyMonitorWebhookSignature({ rawBody, headers: headers(sig), bindings: primaryBindings }),
      401,
    );
  });

  it('rejects a missing signature header', () => {
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody,
          headers: { 'content-type': 'application/json' },
          bindings: primaryBindings,
        }),
      401,
    );
  });

  it('rejects an empty signature header value', () => {
    expectStatus(
      () => verifyMonitorWebhookSignature({ rawBody, headers: headers(''), bindings: primaryBindings }),
      401,
    );
  });

  it('rejects duplicated signature headers (array value)', () => {
    const a = signMonitorWebhookBody(rawBody, PRIMARY);
    const b = signMonitorWebhookBody(rawBody, PREVIOUS);
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({ rawBody, headers: headers([a, b]), bindings: primaryBindings }),
      401,
    );
  });

  it('rejects a comma-joined duplicate signature (Node-joined header)', () => {
    const a = signMonitorWebhookBody(rawBody, PRIMARY);
    const b = signMonitorWebhookBody(rawBody, PREVIOUS);
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody,
          headers: headers(`${a}, ${b}`),
          bindings: [
            ...primaryBindings,
            { secret: PREVIOUS, credentialRef: PRIMARY_REF },
          ],
        }),
      401,
    );
  });

  it.each([
    ['algorithm-confusion sha1', 'sha1=deadbeef'],
    ['algorithm-confusion md5', 'md5=deadbeef'],
    ['literal none', 'none'],
    ['schemeless hex', 'deadbeef'],
    ['non-hex payload', 'sha256=zzzz'],
    ['empty payload', 'sha256='],
    ['uppercase scheme', 'SHA256=deadbeef'],
  ])('rejects a %s signature', (_label, value) => {
    expectStatus(
      () => verifyMonitorWebhookSignature({ rawBody, headers: headers(value), bindings: primaryBindings }),
      401,
    );
  });

  it('rejects an odd-length hex payload without a timingSafeEqual throw', () => {
    const sig = signMonitorWebhookBody(rawBody, PRIMARY);
    const truncated = `${sig.slice(0, sig.length - 1)}`; // drop one hex nibble → odd length
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({ rawBody, headers: headers(truncated), bindings: primaryBindings }),
      401,
    );
  });

  it('throws 500 when no binding is configured', () => {
    const sig = signMonitorWebhookBody(rawBody, PRIMARY);
    expectStatus(
      () => verifyMonitorWebhookSignature({ rawBody, headers: headers(sig), bindings: [] }),
      500,
    );
  });

  it('verifies a signature from either active secret during rotation', () => {
    const withPrimary = signMonitorWebhookBody(rawBody, PRIMARY);
    const withPrevious = signMonitorWebhookBody(rawBody, PREVIOUS);
    const bindings = [
      ...primaryBindings,
      { secret: PREVIOUS, credentialRef: PRIMARY_REF },
    ];
    expect(
      verifyMonitorWebhookSignature({ rawBody, headers: headers(withPrimary), bindings }),
    ).toBe(PRIMARY_REF);
    expect(
      verifyMonitorWebhookSignature({ rawBody, headers: headers(withPrevious), bindings }),
    ).toBe(PRIMARY_REF);
  });

  it('rejects a signature from a retired secret once it leaves the list', () => {
    const withRetired = signMonitorWebhookBody(rawBody, RETIRED);
    // Rotation completed — only PRIMARY remains active.
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody,
          headers: headers(withRetired),
          bindings: primaryBindings,
        }),
      401,
    );
  });

  it('reads the header case-insensitively', () => {
    const sig = signMonitorWebhookBody(rawBody, PRIMARY);
    expect(FIRECRAWL_SIGNATURE_HEADER).toBe('x-firecrawl-signature');
    expect(() =>
      verifyMonitorWebhookSignature({
        rawBody,
        headers: { 'X-Firecrawl-Signature': sig },
        bindings: primaryBindings,
      }),
    ).not.toThrow();
  });

  it('returns a fallback credential only for that fallback secret', () => {
    const signature = signMonitorWebhookBody(rawBody, PREVIOUS);
    expect(
      verifyMonitorWebhookSignature({
        rawBody,
        headers: headers(signature),
        bindings: [
          ...primaryBindings,
          { secret: PREVIOUS, credentialRef: FALLBACK_REF },
        ],
      }),
    ).toBe(FALLBACK_REF);
  });

  it('fails closed on duplicate or empty runtime bindings', () => {
    const signature = signMonitorWebhookBody(rawBody, PRIMARY);
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody,
          headers: headers(signature),
          bindings: [
            ...primaryBindings,
            { secret: PRIMARY, credentialRef: FALLBACK_REF },
          ],
        }),
      500,
    );
    expectStatus(
      () =>
        verifyMonitorWebhookSignature({
          rawBody,
          headers: headers(signature),
          bindings: [{ secret: '', credentialRef: PRIMARY_REF }],
        }),
      500,
    );
  });
});
