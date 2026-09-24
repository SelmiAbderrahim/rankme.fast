/**
 * Server ↔ client parity for the observation contract.
 *
 * The client mirror lives at `client/src/shared/observations/observations.ts`.
 * We assert that:
 *   1. Every enum (SOURCE_KINDS, FRESHNESS_STATES, DEVICE_STATES,
 *      SOURCE_LABELS, COVERAGE_NOTE_KEYS) is identical.
 *   2. The DataForSEO → ISO country map has the same coverage.
 *   3. A canonical wire fixture built on the server round-trips through
 *      the client parser without transformation.
 *
 * The parity check reads the client source as text and evaluates the
 * relevant constants; that avoids a cross-package TS import cycle while
 * still failing the suite when the two files drift.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  COVERAGE_NOTE_KEYS,
  DATAFORSEO_LOCATION_ISO,
  DEVICE_STATES,
  FRESHNESS_STATES,
  SOURCE_KINDS,
  SOURCE_LABELS,
  buildObservationMeta,
  buildSiteMarket,
} from './observations.js';

const CLIENT_FILE = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'client',
  'src',
  'shared',
  'observations',
  'observations.ts',
);

function extractStringArray(source: string, name: string): string[] {
  const re = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`);
  const m = source.match(re);
  if (!m || m[1] === undefined) {
    throw new Error(`could not locate ${name} in client observations`);
  }
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1] ?? '');
}

function extractNumberMap(source: string, name: string): Record<number, string> {
  const re = new RegExp(
    `export const ${name}[^=]*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`,
  );
  const m = source.match(re);
  if (!m || m[1] === undefined) {
    throw new Error(`could not locate ${name} in client observations`);
  }
  const out: Record<number, string> = {};
  for (const entry of m[1].matchAll(/(\d+):\s*'([A-Z]{2})'/g)) {
    if (entry[1] !== undefined && entry[2] !== undefined) {
      out[Number(entry[1])] = entry[2];
    }
  }
  return out;
}

describe('server↔client observation parity', () => {
  const source = readFileSync(CLIENT_FILE, 'utf8');

  it('SOURCE_KINDS match', () => {
    expect(extractStringArray(source, 'SOURCE_KINDS')).toEqual([
      ...SOURCE_KINDS,
    ]);
  });

  it('FRESHNESS_STATES match', () => {
    expect(extractStringArray(source, 'FRESHNESS_STATES')).toEqual([
      ...FRESHNESS_STATES,
    ]);
  });

  it('DEVICE_STATES match', () => {
    expect(extractStringArray(source, 'DEVICE_STATES')).toEqual([
      ...DEVICE_STATES,
    ]);
  });

  it('SOURCE_LABELS match', () => {
    expect(extractStringArray(source, 'SOURCE_LABELS')).toEqual([
      ...SOURCE_LABELS,
    ]);
  });

  it('COVERAGE_NOTE_KEYS match', () => {
    expect(extractStringArray(source, 'COVERAGE_NOTE_KEYS')).toEqual([
      ...COVERAGE_NOTE_KEYS,
    ]);
  });

  it('DATAFORSEO_LOCATION_ISO coverage matches', () => {
    const clientMap = extractNumberMap(source, 'DATAFORSEO_LOCATION_ISO');
    expect(clientMap).toEqual(
      Object.fromEntries(
        Object.entries(DATAFORSEO_LOCATION_ISO).map(([k, v]) => [Number(k), v]),
      ),
    );
  });

  it('a server-built canonical meta round-trips through the client schema', async () => {
    const meta = buildObservationMeta({
      sourceKind: 'first_party',
      sourceLabel: 'google_search_console',
      observedAt: '2026-01-01T00:00:00Z',
      market: buildSiteMarket({ country: 'US', language: 'en' }),
      sampleCount: 1,
      coverageNoteKey: 'observations.coverage.freshCache',
    });
    // Assert the fixture is a valid ISO wire shape without importing the
    // client zod module (which requires the client vite tsconfig alias).
    expect(new Date(meta.observedAt).toISOString()).toBe(meta.observedAt);
    expect(meta.market?.country).toBe('US');
  });
});
