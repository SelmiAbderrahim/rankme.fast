import { describe, expect, it } from 'vitest';
import {
  CONTENT_MONITOR_DIFF_MAX_CHARS,
  contentMonitorDeliveryKey,
  contentMonitorEventKey,
  sanitizeDiffText,
} from './content-monitor.js';

describe('content-monitor helpers', () => {
  it('derives a stable 64-hex event key from provider-neutral fields', () => {
    const a = contentMonitorEventKey('mon_1', 'chk_1', 'https://example.com/a');
    const b = contentMonitorEventKey('mon_1', 'chk_1', 'https://example.com/a');
    const c = contentMonitorEventKey('mon_1', 'chk_1', 'https://example.com/b');
    expect(a).toHaveLength(64);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('preserves legacy receipt keys when no credential affinity exists', () => {
    expect(contentMonitorDeliveryKey('monitor.page', 'check-1')).toBe(
      'monitor.page:check-1',
    );
  });

  it('hashes credential-scoped receipt keys deterministically without embedding the reference', () => {
    const credentialA = 'fc-cred-v1:' + 'a'.repeat(64);
    const credentialB = 'fc-cred-v1:' + 'b'.repeat(64);
    const first = contentMonitorDeliveryKey('monitor.page', 'check-1', credentialA);
    const replay = contentMonitorDeliveryKey('monitor.page', 'check-1', credentialA);
    const otherCredential = contentMonitorDeliveryKey('monitor.page', 'check-1', credentialB);
    const otherCheck = contentMonitorDeliveryKey('monitor.page', 'check-2', credentialA);

    expect(first).toMatch(/^monitor\.page:[0-9a-f]{64}$/);
    expect(first).toBe(replay);
    expect(first).not.toBe(otherCredential);
    expect(first).not.toBe(otherCheck);
    expect(first).not.toContain(credentialA);
  });

  it('returns null for null and undefined diff input', () => {
    expect(sanitizeDiffText(null)).toBeNull();
    expect(sanitizeDiffText(undefined)).toBeNull();
  });

  it('strips HTML markup, control characters, and collapses whitespace', () => {
    const dirty = '<div>Old price</div>\n\n<b>changed</b>\tto new';
    expect(sanitizeDiffText(dirty)).toBe('Old price changed to new');
  });

  it('returns null when nothing survives sanitization', () => {
    expect(sanitizeDiffText('<div></div>')).toBeNull();
    expect(sanitizeDiffText('   ')).toBeNull();
  });

  it('caps the diff at the documented ceiling', () => {
    const long = 'a'.repeat(CONTENT_MONITOR_DIFF_MAX_CHARS + 100);
    expect(sanitizeDiffText(long)!.length).toBe(CONTENT_MONITOR_DIFF_MAX_CHARS);
  });
});
