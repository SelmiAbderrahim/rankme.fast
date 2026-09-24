import { describe, expect, it, vi } from 'vitest';
import { createResendTransport } from './client.js';

const message = {
  to: 'recipient@example.test',
  idempotencyKey: 'content-monitor/receipt-123',
  subject: 'Report ready',
  text: 'Your report is ready.',
  html: '<p>Your report is ready.</p>',
  attachments: [
    {
      filename: 'report.pdf',
      contentBase64: 'JVBERi0=',
      contentType: 'application/pdf',
    },
  ],
};

describe('Resend provider contract', () => {
  it('normalizes a successful response and maps the bounded message shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(
        'content-monitor/receipt-123',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        from: 'sender@example.test',
        to: ['recipient@example.test'],
        subject: 'Report ready',
        text: 'Your report is ready.',
        html: '<p>Your report is ready.</p>',
        attachments: [
          {
            filename: 'report.pdf',
            content: 'JVBERi0=',
            content_type: 'application/pdf',
          },
        ],
      });
      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const transport = createResendTransport({ fetchImpl });

    await expect(
      transport(message, 'sender@example.test', 'secret-key'),
    ).resolves.toEqual({ delivered: true, providerMessageId: 'email_123' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps the configured sender fixed and maps typed reply-to', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('idempotency-key')).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({
          from: 'sender@example.test',
          reply_to: 'reply@example.test',
        }),
      );
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('html');
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('attachments');
      return new Response(JSON.stringify({ id: 'email_custom_from' }), { status: 202 });
    });
    const transport = createResendTransport({ fetchImpl });
    await expect(
      transport(
        {
          ...message,
          idempotencyKey: undefined,
          replyTo: 'reply@example.test',
          html: undefined,
          attachments: undefined,
        },
        'sender@example.test',
        'key',
      ),
    ).resolves.toEqual({ delivered: true, providerMessageId: 'email_custom_from' });
  });

  it('fails closed on quota and server responses without exposing bodies', async () => {
    const onHttpError = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('recipient@example.test must not be logged', { status: 429 }),
    );
    const transport = createResendTransport({ fetchImpl, onHttpError });

    await expect(transport(message, 'sender@example.test', 'key')).resolves.toEqual({
      delivered: false,
    });
    expect(onHttpError).toHaveBeenCalledWith(429);
  });

  it('marks a malformed successful acknowledgement as outcome-unknown', async () => {
    const onMalformedResponse = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('not-json', { status: 200 }),
    );
    const transport = createResendTransport({ fetchImpl, onMalformedResponse });
    await expect(transport(message, 'sender@example.test', 'key')).resolves.toEqual({
      delivered: false,
      outcomeUnknown: true,
    });
    expect(onMalformedResponse).toHaveBeenCalledOnce();
  });

  it('propagates timeout/network failures to the registry failure boundary', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw timeout;
    });
    const transport = createResendTransport({ fetchImpl, timeoutMs: 1 });
    await expect(transport(message, 'sender@example.test', 'key')).rejects.toBe(timeout);
  });
});
