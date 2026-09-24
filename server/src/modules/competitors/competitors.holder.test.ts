import { afterEach, describe, expect, it } from 'vitest';
import {
  getCompetitorProvider,
  getCompetitorsDb,
  setCompetitorProvider,
  setCompetitorsDb,
} from './competitors.holder.js';
import { createFakeCompetitorProvider } from '../../shared/providers/index.js';

afterEach(() => {
  setCompetitorsDb(null);
  setCompetitorProvider(null);
});

describe('competitors holder', () => {
  it('throws when db not configured', () => {
    expect(() => getCompetitorsDb()).toThrow(/not configured/);
  });

  it('returns db once set', () => {
    const db = { probe: 'db' } as unknown as never;
    setCompetitorsDb(db);
    expect(getCompetitorsDb()).toBe(db);
  });

  it('throws when provider not configured', () => {
    expect(() => getCompetitorProvider()).toThrow(/not configured/);
  });

  it('returns provider once set', () => {
    const p = createFakeCompetitorProvider();
    setCompetitorProvider(p);
    expect(getCompetitorProvider()).toBe(p);
  });
});
