import { describe, expect, it } from 'vitest';
import { HttpError } from '../utils/http-error.js';
import {
  assertSiteAllowed,
  assertSpendAllowed,
  isToolAllowed,
  resolveEffectivePermissions,
} from './engine.js';
import { parseStoredScopes } from './types.js';

const TOOLS = ['list_sites', 'start_audit', 'get_rank_history'] as const;

describe('resolveEffectivePermissions — tool intersection table', () => {
  interface Row {
    account: boolean | undefined;
    key: boolean | undefined;
    expected: boolean;
  }
  const rows: Row[] = [
    { account: undefined, key: undefined, expected: true },
    { account: true, key: undefined, expected: true },
    { account: undefined, key: true, expected: true },
    { account: true, key: true, expected: true },
    { account: false, key: undefined, expected: false },
    { account: undefined, key: false, expected: false },
    { account: false, key: true, expected: false },
    { account: true, key: false, expected: false },
    { account: false, key: false, expected: false },
  ];
  for (const { account, key, expected } of rows) {
    it(`account=${String(account)} ∩ key=${String(key)} → ${String(expected)}`, () => {
      const eff = resolveEffectivePermissions(
        account === undefined ? {} : { tools: { start_audit: account } },
        key === undefined ? null : { tools: { start_audit: key } },
        TOOLS,
      );
      expect(eff.tools.start_audit).toBe(expected);
      // Untouched tools stay permissive.
      expect(eff.tools.list_sites).toBe(true);
    });
  }

  it('null specs on both sides are fully permissive', () => {
    const eff = resolveEffectivePermissions(null, null, TOOLS);
    expect(eff).toEqual({
      tools: { list_sites: true, start_audit: true, get_rank_history: true },
      allowedSiteIds: null,
      allowSpend: true,
    });
  });
});

describe('resolveEffectivePermissions — allowedSiteIds', () => {
  it('neither set → null (all sites)', () => {
    expect(resolveEffectivePermissions({}, {}, TOOLS).allowedSiteIds).toBeNull();
  });

  it('empty stored lists read as all sites, never a lockout', () => {
    expect(
      resolveEffectivePermissions({ allowedSiteIds: [] }, { allowedSiteIds: [] }, TOOLS)
        .allowedSiteIds,
    ).toBeNull();
  });

  it('only account set → the account list', () => {
    expect(
      resolveEffectivePermissions({ allowedSiteIds: ['a', 'b'] }, null, TOOLS)
        .allowedSiteIds,
    ).toEqual(['a', 'b']);
  });

  it('only key set → the key list', () => {
    expect(
      resolveEffectivePermissions(null, { allowedSiteIds: ['c'] }, TOOLS).allowedSiteIds,
    ).toEqual(['c']);
  });

  it('both set → the intersection (key can only restrict)', () => {
    expect(
      resolveEffectivePermissions(
        { allowedSiteIds: ['a', 'b', 'c'] },
        { allowedSiteIds: ['b', 'c', 'd'] },
        TOOLS,
      ).allowedSiteIds,
    ).toEqual(['b', 'c']);
  });

  it('disjoint lists intersect to an empty allow-list (every site blocked)', () => {
    expect(
      resolveEffectivePermissions(
        { allowedSiteIds: ['a'] },
        { allowedSiteIds: ['b'] },
        TOOLS,
      ).allowedSiteIds,
    ).toEqual([]);
  });
});

describe('resolveEffectivePermissions — allowSpend', () => {
  it('missing on both sides → true', () => {
    expect(resolveEffectivePermissions({}, null, TOOLS).allowSpend).toBe(true);
  });
  it('false on either side wins', () => {
    expect(
      resolveEffectivePermissions({ allowSpend: false }, { allowSpend: true }, TOOLS)
        .allowSpend,
    ).toBe(false);
    expect(
      resolveEffectivePermissions({ allowSpend: true }, { allowSpend: false }, TOOLS)
        .allowSpend,
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('isToolAllowed reads the resolved map and stays permissive on unknown names', () => {
    const eff = resolveEffectivePermissions({ tools: { start_audit: false } }, null, TOOLS);
    expect(isToolAllowed(eff, 'start_audit')).toBe(false);
    expect(isToolAllowed(eff, 'list_sites')).toBe(true);
    expect(isToolAllowed(eff, 'not_in_registry')).toBe(true);
  });

  it('assertSiteAllowed passes on null allow-list and allowed ids', () => {
    const all = resolveEffectivePermissions(null, null, TOOLS);
    expect(() => assertSiteAllowed(all, 'anything')).not.toThrow();
    const scoped = resolveEffectivePermissions({ allowedSiteIds: ['a'] }, null, TOOLS);
    expect(() => assertSiteAllowed(scoped, 'a')).not.toThrow();
  });

  it('assertSiteAllowed throws the not-owned-site 404 shape for blocked ids', () => {
    const scoped = resolveEffectivePermissions({ allowedSiteIds: ['a'] }, null, TOOLS);
    try {
      assertSiteAllowed(scoped, 'b');
      expect.unreachable('must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(404);
      expect((err as HttpError).message).toBe('sites.errors.notFound');
    }
  });

  it('assertSpendAllowed throws the localized forbidden key when spend is off', () => {
    const off = resolveEffectivePermissions({ allowSpend: false }, null, TOOLS);
    try {
      assertSpendAllowed(off);
      expect.unreachable('must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).message).toBe('mcp.errors.spendNotAllowed');
    }
    const on = resolveEffectivePermissions(null, null, TOOLS);
    expect(() => assertSpendAllowed(on)).not.toThrow();
  });

  it('composes with parseStoredScopes: malformed key scopes fall back to permissive', () => {
    const eff = resolveEffectivePermissions(
      { tools: { start_audit: false } },
      parseStoredScopes({ garbage: true }),
      TOOLS,
    );
    expect(eff.tools.start_audit).toBe(false);
    expect(eff.tools.list_sites).toBe(true);
  });
});
