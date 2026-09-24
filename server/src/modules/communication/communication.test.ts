import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createApp } from '../../app.js';
import * as mailgunShim from './mailers/mailgun.js';
import { setResendTransport, type EmailMessage } from './mailers/resend.js';
import { env } from '../../config/env.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

// Raise the shared contact-form limiter so unrelated suites in this file
// are never throttled by the app-wide MemoryStore. The dedicated rate-limit
// describe builds its own scoped app after overriding down.
(env as { RATE_LIMIT_CONTACT_MAX: number }).RATE_LIMIT_CONTACT_MAX = 100_000;
const app = createApp();

beforeAll(async () => {
  const db = await startTestPostgres();
  setRateLimitMetricsDb(db as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
});

afterAll(async () => {
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('legacy mailgun shim', () => {
  it('re-exports the Resend transport for back-compat imports', () => {
    expect(typeof mailgunShim.sendEmail).toBe('function');
    expect(typeof mailgunShim.setResendTransport).toBe('function');
    expect(typeof mailgunShim.getResendTransport).toBe('function');
  });
});

describe('communication module', () => {
  it('rejects empty contact form payloads', async () => {
    const res = await request(app).post('/api/communication/contact').send({});
    expect(res.status).toBe(400);
  });

  it('accepts a well-formed contact form even without resend configured', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      subject: 'Hello',
      message: 'Just checking in.',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/has been sent/i);
  });

  it('localizes the contact confirmation via Accept-Language', async () => {
    const res = await request(app)
      .post('/api/communication/contact')
      .set('Accept-Language', 'fr')
      .send({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean@example.com',
        subject: 'Bonjour',
        message: 'Salut.',
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/envoyé/i);
  });
});

describe('contact form — bounded string lengths', () => {
  it('an over-length firstName → 400', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'a'.repeat(101),
      lastName: 'Doe',
      email: 'jane@example.com',
      subject: 'Hi',
      message: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('an over-length lastName → 400', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'Jane',
      lastName: 'a'.repeat(101),
      email: 'jane@example.com',
      subject: 'Hi',
      message: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('an over-length email → 400', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'Jane',
      lastName: 'Doe',
      email: `${'a'.repeat(310)}@example.com`,
      subject: 'Hi',
      message: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('an over-length subject → 400', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      subject: 'x'.repeat(201),
      message: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('an over-length message → 400', async () => {
    const res = await request(app).post('/api/communication/contact').send({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      subject: 'Hi',
      message: 'x'.repeat(5001),
    });
    expect(res.status).toBe(400);
  });
});

describe('contact form — header injection defense', () => {
  it('uses the configured sender, a typed reply-to, and a sanitized subject', async () => {
    // sendEmail short-circuits when RESEND_API_KEY/RESEND_FROM are unset, so
    // set both for this test AND install a capture transport.
    const originalKey = env.RESEND_API_KEY;
    const originalFrom = env.RESEND_FROM;
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'test-key';
    (env as { RESEND_FROM?: string }).RESEND_FROM = 'noreply@example.com';
    const captured: Array<{ message: EmailMessage; from: string }> = [];
    setResendTransport(async (message, from) => {
      captured.push({ message, from });
      return { delivered: true };
    });
    try {
      const res = await request(app).post('/api/communication/contact').send({
        firstName: 'Eve\r\nBcc: victim@x.com',
        lastName: '<Malory>',
        email: 'eve@example.com',
        subject: 'Hi\r\nCc: leaker@x.com',
        message: 'body',
      });
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const sent = captured[0];
      if (!sent) throw new Error('unreachable');
      expect(sent.from).toBe('noreply@example.com');
      expect(sent.message.replyTo).toBe('eve@example.com');
      expect(sent.message.subject).not.toMatch(/[\r\n]/);
      expect(sent.message.text).toContain('Contact from EveBcc: victim@x.com Malory');
    } finally {
      setResendTransport(null);
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = originalKey;
      (env as { RESEND_FROM?: string }).RESEND_FROM = originalFrom;
    }
  });
});

describe('contact form — rate limiting', () => {
  let scopedApp: ReturnType<typeof createApp>;
  let originalMax: number;
  let originalWindow: number;

  beforeEach(() => {
    originalMax = env.RATE_LIMIT_CONTACT_MAX;
    originalWindow = env.RATE_LIMIT_CONTACT_WINDOW_MS;
    (env as { RATE_LIMIT_CONTACT_MAX: number }).RATE_LIMIT_CONTACT_MAX = 2;
    (env as { RATE_LIMIT_CONTACT_WINDOW_MS: number }).RATE_LIMIT_CONTACT_WINDOW_MS = 60_000;
    scopedApp = createApp();
  });

  afterEach(() => {
    (env as { RATE_LIMIT_CONTACT_MAX: number }).RATE_LIMIT_CONTACT_MAX = originalMax;
    (env as { RATE_LIMIT_CONTACT_WINDOW_MS: number }).RATE_LIMIT_CONTACT_WINDOW_MS = originalWindow;
  });

  it('the N+1th contact POST from one IP → 429', async () => {
    const payload = {
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.co',
      subject: 'S',
      message: 'M',
    };
    await request(scopedApp).post('/api/communication/contact').send(payload).expect(200);
    await request(scopedApp).post('/api/communication/contact').send(payload).expect(200);
    const overflow = await request(scopedApp)
      .post('/api/communication/contact')
      .send(payload);
    expect(overflow.status).toBe(429);
    expect(typeof overflow.body.error).toBe('string');
  });
});
