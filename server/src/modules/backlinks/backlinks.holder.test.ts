import { afterEach, describe, expect, it } from 'vitest';
import {
  getBacklinkProvider,
  getBacklinksDb,
  setBacklinkProvider,
  setBacklinksDb,
} from './backlinks.holder.js';
import { createFakeBacklinkProvider } from '../../shared/providers/index.js';

afterEach(() => {
  setBacklinksDb(null);
  setBacklinkProvider(null);
});

describe('backlinks holder', () => {
  it('throws when db not configured', () => {
    expect(() => getBacklinksDb()).toThrow(/not configured/);
  });

  it('returns db once set', () => {
    const db = { probe: 'db' } as unknown as never;
    setBacklinksDb(db);
    expect(getBacklinksDb()).toBe(db);
  });

  it('throws when provider not configured', () => {
    expect(() => getBacklinkProvider()).toThrow(/not configured/);
  });

  it('returns provider once set', () => {
    const p = createFakeBacklinkProvider();
    setBacklinkProvider(p);
    expect(getBacklinkProvider()).toBe(p);
  });
});
