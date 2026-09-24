import { describe, expect, it } from 'vitest';
import { firecrawlCredentialRef } from './firecrawl-credential-ref.js';

describe('firecrawlCredentialRef', () => {
  it('derives a stable, one-way reference that never contains the key', () => {
    const ref = firecrawlCredentialRef('  a-configured-key  ');
    expect(ref).toBe(firecrawlCredentialRef('a-configured-key'));
    expect(ref).not.toContain('a-configured-key');
    expect(ref).toMatch(/^fc-cred-v1:[0-9a-f]{16,}$/);
    expect(firecrawlCredentialRef('another-key')).not.toBe(ref);
  });

  it('refuses an empty or whitespace-only key instead of hashing nothing', () => {
    expect(() => firecrawlCredentialRef('')).toThrow(/must not be empty/);
    expect(() => firecrawlCredentialRef('   ')).toThrow(/must not be empty/);
  });
});
