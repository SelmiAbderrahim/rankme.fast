import { afterEach, describe, expect, it } from 'vitest';
import { getApiKeysDb, setApiKeysDb } from './api-keys.holder.js';

afterEach(() => {
  setApiKeysDb(null);
});

describe('api-keys holder', () => {
  it('getApiKeysDb throws when unset', () => {
    expect(() => getApiKeysDb()).toThrow(/api-keys db not configured/);
  });

  it('roundtrips the db handle', () => {
    const db = {} as never;
    setApiKeysDb(db);
    expect(getApiKeysDb()).toBe(db);
  });
});
