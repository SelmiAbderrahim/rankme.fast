import { describe, expect, it } from 'vitest';
import { CooldownError, createInMemoryCooldown } from './in-memory-cooldown.js';

describe('createInMemoryCooldown', () => {
  it('assert passes for a key that was never touched', () => {
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000 });
    expect(() => cooldown.assert('backlinks:a')).not.toThrow();
  });

  it('assert throws CooldownError with accurate retryAfterMs inside the window', () => {
    let clock = 1_000;
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000, now: () => clock });
    cooldown.touch('backlinks:a');
    clock += 25_000;
    let caught: unknown;
    try {
      cooldown.assert('backlinks:a');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CooldownError);
    expect((caught as CooldownError).retryAfterMs).toBe(35_000);
    expect((caught as CooldownError).name).toBe('CooldownError');
  });

  it('assert passes once the window has fully elapsed', () => {
    let clock = 0;
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000, now: () => clock });
    cooldown.touch('k');
    clock = 60_000;
    expect(() => cooldown.assert('k')).not.toThrow();
  });

  it('per-call ms override wins over defaultMs', () => {
    let clock = 0;
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000, now: () => clock });
    cooldown.touch('k');
    clock = 5_000;
    // Default window (60s) would throw; a 5s override passes.
    expect(() => cooldown.assert('k', 5_000)).not.toThrow();
    // A longer override still throws with the override-based remainder.
    expect(() => cooldown.assert('k', 10_000)).toThrowError(CooldownError);
    try {
      cooldown.assert('k', 10_000);
    } catch (err) {
      expect((err as CooldownError).retryAfterMs).toBe(5_000);
    }
  });

  it('keys are independent — touching one does not block another', () => {
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000, now: () => 0 });
    cooldown.touch('backlinks:a');
    expect(() => cooldown.assert('backlinks:b')).not.toThrow();
    expect(() => cooldown.assert('competitors:a')).not.toThrow();
  });

  it('clear forgets the key so the next assert passes', () => {
    let clock = 0;
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000, now: () => clock });
    cooldown.touch('k');
    clock = 1;
    expect(() => cooldown.assert('k')).toThrowError(CooldownError);
    cooldown.clear('k');
    expect(() => cooldown.assert('k')).not.toThrow();
  });

  it('defaults to the wall clock when no now() is injected', () => {
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000 });
    cooldown.touch('k');
    expect(() => cooldown.assert('k')).toThrowError(CooldownError);
  });
});
