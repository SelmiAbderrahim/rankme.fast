import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationDb } from '../../shared/types/application-db.js';
import { getSitesDb, setSitesDb } from './sites.holder.js';

afterEach(() => {
  setSitesDb(null);
});

describe('sites db-holder', () => {
  it('throws until setSitesDb() wires the handle', () => {
    expect(() => getSitesDb()).toThrow('sites db not configured');
  });

  it('setSitesDb swaps the current handle in and out', () => {
    const fake = { fake: true } as unknown as ApplicationDb;
    setSitesDb(fake);
    expect(getSitesDb()).toBe(fake);
    setSitesDb(null);
    expect(() => getSitesDb()).toThrow('sites db not configured');
  });
});
