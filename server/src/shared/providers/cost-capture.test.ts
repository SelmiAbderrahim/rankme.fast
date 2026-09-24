/**
 * Ambient vendor-cost capture (cost-capture.ts): USD→micros conversion edge
 * cases, no-scope no-ops, multi-record summing, the null-vs-0n distinction
 * ("nothing recorded" vs "vendor charged zero"), and nested-scope isolation.
 */
import { describe, expect, it } from 'vitest';
import { captureVendorCost, recordVendorCostUsd, usdToMicros } from './cost-capture.js';

describe('usdToMicros', () => {
  it('converts vendor float USD to bigint micros', () => {
    expect(usdToMicros(0.002)).toBe(2_000n);
    expect(usdToMicros(0.0006)).toBe(600n);
    expect(usdToMicros(1)).toBe(1_000_000n);
    expect(usdToMicros(0)).toBe(0n);
  });

  it('rounds float artifacts instead of truncating', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    expect(usdToMicros(0.1 + 0.2)).toBe(300_000n);
    expect(usdToMicros(0.0000004)).toBe(0n);
    expect(usdToMicros(0.0000006)).toBe(1n);
  });

  it('rejects garbage input as null', () => {
    expect(usdToMicros(Number.NaN)).toBeNull();
    expect(usdToMicros(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usdToMicros(-0.01)).toBeNull();
  });
});

describe('recordVendorCostUsd', () => {
  it('is a no-op outside a capture scope', () => {
    expect(() => recordVendorCostUsd(0.5)).not.toThrow();
  });
});

describe('captureVendorCost', () => {
  it('sums every record inside the scope', async () => {
    const { value, costMicros } = await captureVendorCost(async () => {
      recordVendorCostUsd(0.002);
      recordVendorCostUsd(0.0006);
      recordVendorCostUsd(0.1);
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(costMicros).toBe(102_600n);
  });

  it('resolves null when nothing was recorded', async () => {
    const { costMicros } = await captureVendorCost(async () => 42);
    expect(costMicros).toBeNull();
  });

  it('keeps a recorded zero distinct from "unrecorded"', async () => {
    const { costMicros } = await captureVendorCost(async () => {
      recordVendorCostUsd(0);
    });
    expect(costMicros).toBe(0n);
  });

  it('ignores null, undefined, and garbage records', async () => {
    const { costMicros } = await captureVendorCost(async () => {
      recordVendorCostUsd(null);
      recordVendorCostUsd(undefined);
      recordVendorCostUsd(Number.NaN);
      recordVendorCostUsd(-5);
    });
    expect(costMicros).toBeNull();
  });

  it('isolates nested capture scopes', async () => {
    const { value, costMicros } = await captureVendorCost(async () => {
      const inner = await captureVendorCost(async () => {
        recordVendorCostUsd(0.01);
        return 'inner';
      });
      return inner;
    });
    expect(value.value).toBe('inner');
    expect(value.costMicros).toBe(10_000n);
    // The inner scope swallowed its records — the outer saw none.
    expect(costMicros).toBeNull();
  });

  it('propagates the wrapped function rejection', async () => {
    await expect(
      captureVendorCost(async () => {
        throw new Error('vendor down');
      }),
    ).rejects.toThrow('vendor down');
  });
});
