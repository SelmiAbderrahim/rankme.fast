import { Types } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { User } from '../users/users.model.js';
import {
  deliverClientReportEmail,
  prepareClientReportEmail,
  setResendTransport,
  type EmailMessage,
} from './index.js';

const originalKey = env.RESEND_API_KEY;
const originalFrom = env.RESEND_FROM;

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);

beforeEach(async () => {
  await clearCollections();
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'test-resend-key';
  (env as { RESEND_FROM?: string }).RESEND_FROM = 'reports@example.test';
});

afterEach(() => {
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = originalKey;
  (env as { RESEND_FROM?: string }).RESEND_FROM = originalFrom;
  setResendTransport(null);
});

describe('deliverClientReportEmail', () => {
  it('isolates recipients, honours preferences, suppresses removed users, and attaches one frozen PDF', async () => {
    const optedOut = await User.create({
      _id: new Types.ObjectId(),
      email: 'opted-out@example.test',
      emailVerified: true,
      notificationPreferences: { emailAuditComplete: false },
    });
    const sent: EmailMessage[] = [];
    setResendTransport(async (message) => {
      sent.push(message);
      if (message.to === 'a-fail@example.test') throw new Error('transport exploded');
      return { delivered: true, providerMessageId: `message-${sent.length}` };
    });

    const prepared = await prepareClientReportEmail({
      recipients: [
        {
          email: 'z-success@example.test',
          membership: 'external',
          idempotencyKey: 'client-report/z-success',
        },
        {
          email: 'removed@example.test',
          membership: 'removed',
          idempotencyKey: 'client-report/removed',
        },
        {
          email: 'opted-out@example.test',
          userId: optedOut.id as string,
          membership: 'active',
          idempotencyKey: 'client-report/opted-out',
        },
        {
          email: 'a-fail@example.test',
          membership: 'external',
          idempotencyKey: 'client-report/a-fail',
        },
      ],
      siteLabel: '<Client & Co>',
      snapshotDate: '2026-07-22T08:00:00.000Z',
      pdfBytes: Uint8Array.from([37, 80, 68, 70, 45]),
      locale: 'en',
    });

    const outcomes = [
      ...prepared.suppressed,
      ...(await deliverClientReportEmail({
        recipients: prepared.recipients,
        payload: prepared.payload,
      })),
    ].sort((a, b) => a.email.localeCompare(b.email));
    expect(outcomes).toEqual([
      {
        email: 'a-fail@example.test',
        status: 'failed',
        suppressionReason: null,
        errorCode: 'provider_outcome_unknown',
        providerMessageId: null,
      },
      {
        email: 'opted-out@example.test',
        status: 'suppressed',
        suppressionReason: 'preference',
        errorCode: null,
        providerMessageId: null,
      },
      {
        email: 'removed@example.test',
        status: 'suppressed',
        suppressionReason: 'removed_user',
        errorCode: null,
        providerMessageId: null,
      },
      {
        email: 'z-success@example.test',
        status: 'sent',
        suppressionReason: null,
        errorCode: null,
        providerMessageId: 'message-2',
      },
    ]);
    expect(sent.map((message) => message.to)).toEqual([
      'a-fail@example.test',
      'z-success@example.test',
    ]);
    expect(sent.map((message) => message.idempotencyKey)).toEqual([
      'client-report/a-fail',
      'client-report/z-success',
    ]);
    expect(sent[1]!.attachments).toEqual([{
      filename: 'client-report.pdf',
      contentBase64: 'JVBERi0=',
      contentType: 'application/pdf',
    }]);
    expect(sent[1]!.html).toContain('&lt;Client &amp; Co&gt;');
    expect(sent[1]!.html).not.toContain('<Client & Co>');
  });

  it('suppresses every recipient before transport when Resend is unavailable', async () => {
    const transport = vi.fn(async () => ({ delivered: true }));
    setResendTransport(transport);
    const prepared = await prepareClientReportEmail({
      recipients: [{
        email: 'client@example.test',
        membership: 'external',
        idempotencyKey: 'client-report/transport-off',
      }],
      siteLabel: 'Client',
      snapshotDate: '2026-07-22',
      pdfBytes: new Uint8Array(),
      transportAvailable: () => false,
    });
    expect(prepared.suppressed[0]).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'transport',
    });
    expect(prepared.recipients).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('classifies an explicit provider refusal as a reported transport failure', async () => {
    setResendTransport(async () => ({ delivered: false }));
    const prepared = await prepareClientReportEmail({
      recipients: [{
        email: 'client@example.test',
        membership: 'external',
        idempotencyKey: 'client-report/provider-refusal',
      }],
      siteLabel: 'Client',
      snapshotDate: '2026-07-22',
      pdfBytes: new Uint8Array(),
    });

    await expect(
      deliverClientReportEmail({
        recipients: prepared.recipients,
        payload: prepared.payload,
      }),
    ).resolves.toEqual([
      {
        email: 'client@example.test',
        status: 'failed',
        suppressionReason: null,
        errorCode: 'transport_reported_failure',
        providerMessageId: null,
      },
    ]);
  });

  it.each(SUPPORTED_LOCALES)('renders the subject/body in %s', async (locale) => {
    const send = vi.fn(async (_message: EmailMessage) => ({ delivered: true }));
    setResendTransport(send);
    const prepared = await prepareClientReportEmail({
      recipients: [{
        email: 'client@example.test',
        membership: 'external',
        idempotencyKey: `client-report/locale-${locale}`,
      }],
      siteLabel: 'Example',
      snapshotDate: '2026-07-22',
      pdfBytes: new Uint8Array(),
      locale,
    });
    await deliverClientReportEmail({
      recipients: prepared.recipients,
      payload: prepared.payload,
    });
    const message = send.mock.calls[0]![0];
    expect(message.subject).not.toContain('clientReports.');
    expect(message.text).toContain('Example');
    expect(message.text).toContain('2026-07-22');
    expect(message.html).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`);
  });
});
