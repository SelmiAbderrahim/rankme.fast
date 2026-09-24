import { appendFile, chmod, stat, writeFile } from 'node:fs/promises';
import type { EmailMessage } from './email.js';
/** Fixed container-local path; callers cannot redirect writes through env input. */
export const E2E_EMAIL_OUTBOX_PATH = '/tmp/rankme-e2e-email-outbox.jsonl';
const MAX_OUTBOX_BYTES = 1024 * 1024;
const MAX_TO_CHARS = 320;
const MAX_SUBJECT_CHARS = 1000;
const MAX_TEXT_CHARS = 64 * 1024;
const MAX_HTML_CHARS = 128 * 1024;
export interface CapturedE2eEmail {
    capturedAt: string;
    to: string;
    subject: string;
    text: string;
    html: string | null;
}
/**
 * Store only the fields Playwright must prove. Attachments and provider
 * metadata are deliberately excluded, every field is bounded, and the whole
 * mailbox rolls over before one MiB. This is called only when the validated
 * E2E_EMAIL_CAPTURE + fake-provider pair is enabled.
 */
export async function captureE2eEmail(message: EmailMessage): Promise<void> {
    const record: CapturedE2eEmail = {
        capturedAt: new Date().toISOString(),
        to: message.to.slice(0, MAX_TO_CHARS),
        subject: message.subject.slice(0, MAX_SUBJECT_CHARS),
        text: message.text.slice(0, MAX_TEXT_CHARS),
        html: message.html?.slice(0, MAX_HTML_CHARS) ?? null,
    };
    const line = `${JSON.stringify(record)}\n`;
    const currentBytes = await stat(E2E_EMAIL_OUTBOX_PATH).then((value) => value.size, () => 0);
    if (currentBytes + Buffer.byteLength(line, 'utf8') > MAX_OUTBOX_BYTES) {
        await writeFile(E2E_EMAIL_OUTBOX_PATH, '', { encoding: 'utf8', mode: 0o600 });
    }
    await appendFile(E2E_EMAIL_OUTBOX_PATH, line, { encoding: 'utf8', mode: 0o600 });
    await chmod(E2E_EMAIL_OUTBOX_PATH, 0o600);
}
