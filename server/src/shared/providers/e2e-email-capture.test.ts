import { chmod, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureE2eEmail,
  E2E_EMAIL_OUTBOX_PATH,
  type CapturedE2eEmail,
} from './e2e-email-capture.js';

async function removeOutbox(): Promise<void> {
  await unlink(E2E_EMAIL_OUTBOX_PATH).catch(() => undefined);
}

async function records(): Promise<CapturedE2eEmail[]> {
  return (await readFile(E2E_EMAIL_OUTBOX_PATH, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as CapturedE2eEmail);
}

describe('E2E email capture', () => {
  afterEach(removeOutbox);

  it('creates a private bounded record without attachments', async () => {
    await removeOutbox();
    await captureE2eEmail({
      to: `${'x'.repeat(400)}@example.test`,
      subject: 'Credential invite',
      text: 'temporary-password',
      html: '<strong>temporary-password</strong>',
      attachments: [{ filename: 'secret.txt', contentBase64: 'c2VjcmV0', contentType: 'text/plain' }],
    });

    const [record] = await records();
    expect(record).toMatchObject({
      subject: 'Credential invite',
      text: 'temporary-password',
      html: '<strong>temporary-password</strong>',
    });
    expect(record?.to).toHaveLength(320);
    expect(record).not.toHaveProperty('attachments');
    expect(record?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect((await stat(E2E_EMAIL_OUTBOX_PATH)).mode & 0o777).toBe(0o600);
  });

  it('appends records, represents missing html as null, and rolls over at one MiB', async () => {
    await captureE2eEmail({ to: 'first@example.test', subject: 'first', text: 'one' });
    await captureE2eEmail({ to: 'second@example.test', subject: 'second', text: 'two' });
    expect((await records()).map((record) => record.subject)).toEqual(['first', 'second']);
    expect((await records())[0]?.html).toBeNull();

    await writeFile(E2E_EMAIL_OUTBOX_PATH, 'x'.repeat(1024 * 1024), 'utf8');
    await chmod(E2E_EMAIL_OUTBOX_PATH, 0o644);
    await captureE2eEmail({ to: 'latest@example.test', subject: 'latest', text: 'three' });
    expect((await records()).map((record) => record.subject)).toEqual(['latest']);
    expect((await stat(E2E_EMAIL_OUTBOX_PATH)).mode & 0o777).toBe(0o600);
  });
});
