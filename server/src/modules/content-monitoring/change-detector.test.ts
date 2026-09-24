import { describe, expect, it } from 'vitest';
import {
  CHANGE_DETECTOR_VERSION,
  detectChange,
  normalizeFingerprint,
} from './change-detector.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('normalizeFingerprint', () => {
  it('derives a versioned fingerprint from the content hash', () => {
    const fp = normalizeFingerprint({ status: 'changed', contentHash: HASH_A, diffText: null });
    expect(fp).toHaveLength(64);
    // Stable + version-bound.
    expect(fp).toBe(normalizeFingerprint({ status: 'same', contentHash: ` ${HASH_A} `, diffText: null }));
  });

  it('falls back to the diff text when no content hash is present', () => {
    const fp = normalizeFingerprint({ status: 'changed', contentHash: null, diffText: 'a b c' });
    expect(fp).toHaveLength(64);
    expect(fp).not.toBe(
      normalizeFingerprint({ status: 'changed', contentHash: null, diffText: 'x y z' }),
    );
  });

  it('returns null when neither a hash nor a diff is present', () => {
    expect(normalizeFingerprint({ status: 'same', contentHash: '  ', diffText: '  ' })).toBeNull();
    expect(normalizeFingerprint({ status: 'same', contentHash: null, diffText: null })).toBeNull();
  });
});

describe('detectChange', () => {
  it('records a first observation without notifying', () => {
    const d = detectChange(
      { normalizedHash: null },
      { status: 'new', contentHash: HASH_A, diffText: null },
    );
    expect(d).toMatchObject({ material: false, reason: 'first_observation', detectorVersion: CHANGE_DETECTOR_VERSION });
    expect(d.normalizedHash).toHaveLength(64);
  });

  it('flags a material change when the normalized hash moves', () => {
    const prior = normalizeFingerprint({ status: 'changed', contentHash: HASH_A, diffText: null });
    const d = detectChange(
      { normalizedHash: prior },
      { status: 'changed', contentHash: HASH_B, diffText: '- old\n+ new' },
    );
    expect(d.material).toBe(true);
    expect(d.reason).toBe('hash_changed');
  });

  it('suppresses vendor-flagged change when the normalized hash is identical (noise)', () => {
    const prior = normalizeFingerprint({ status: 'changed', contentHash: HASH_A, diffText: null });
    const d = detectChange(
      { normalizedHash: prior },
      { status: 'changed', contentHash: HASH_A, diffText: null },
    );
    expect(d).toMatchObject({ material: false, reason: 'noise_suppressed' });
    expect(d.normalizedHash).toBe(prior);
  });

  it('suppresses a "new" status whose fingerprint did not move', () => {
    const prior = normalizeFingerprint({ status: 'new', contentHash: HASH_A, diffText: null });
    const d = detectChange(
      { normalizedHash: prior },
      { status: 'new', contentHash: HASH_A, diffText: null },
    );
    expect(d.reason).toBe('noise_suppressed');
  });

  it('treats a same status with an identical hash as unchanged', () => {
    const prior = normalizeFingerprint({ status: 'same', contentHash: HASH_A, diffText: null });
    const d = detectChange(
      { normalizedHash: prior },
      { status: 'same', contentHash: HASH_A, diffText: null },
    );
    expect(d).toMatchObject({ material: false, reason: 'unchanged' });
  });

  it('flags a removed page as material and keeps the prior hash', () => {
    const d = detectChange(
      { normalizedHash: HASH_A },
      { status: 'removed', contentHash: null, diffText: null },
    );
    expect(d).toMatchObject({ material: true, reason: 'page_removed', normalizedHash: HASH_A });
  });

  it('suppresses repeated removed observations after the removed baseline is committed', () => {
    const d = detectChange(
      { normalizedHash: HASH_A, status: 'removed' },
      { status: 'removed', contentHash: null, diffText: null },
    );
    expect(d).toMatchObject({
      material: false,
      reason: 'unchanged',
      normalizedHash: HASH_A,
      normalizedStatus: 'removed',
    });
  });

  it('flags a present page after removal as a restoration', () => {
    const d = detectChange(
      { normalizedHash: HASH_A, status: 'removed' },
      { status: 'same', contentHash: HASH_A, diffText: null },
    );
    expect(d).toMatchObject({
      material: true,
      reason: 'page_restored',
      normalizedStatus: 'same',
    });
  });

  it('never flags an error status and keeps the prior hash', () => {
    const d = detectChange(
      { normalizedHash: HASH_A },
      { status: 'error', contentHash: null, diffText: null },
    );
    expect(d).toMatchObject({ material: false, reason: 'error_status', normalizedHash: HASH_A });
  });

  it('keeps the prior hash when a restored page carries no fingerprint', () => {
    // `normalizeFingerprint` returns null with neither a contentHash nor a
    // diff, so the restoration must fall back to the stored baseline rather
    // than blanking it.
    const d = detectChange(
      { normalizedHash: HASH_A, status: 'removed' },
      { status: 'changed', contentHash: null, diffText: null },
    );
    expect(d).toMatchObject({
      material: true,
      reason: 'page_restored',
      normalizedHash: HASH_A,
      normalizedStatus: 'changed',
    });
  });
});
