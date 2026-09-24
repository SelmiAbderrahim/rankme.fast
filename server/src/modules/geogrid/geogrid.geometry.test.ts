/**
 * Cell-derivation property tests.
 *
 * The sweeps are deterministic: nested loops over the validated bound corners
 * plus a fixed linear-congruential sequence seeded in-test. No `Math.random`,
 * no clock — the same run always exercises the same coordinates.
 */
import { describe, expect, it } from 'vitest';
import {
  GEOGRID_MAX_ABS_CENTER_LAT,
  GEOGRID_MAX_SPACING_METERS,
  GEOGRID_MIN_SPACING_METERS,
  GEOGRID_SIZES,
  type GeogridSize,
} from '../../db/schema/geogrid.js';
import { formatLocationCoordinate } from '../../shared/providers/dataforseo/serp.js';
import {
  centerPointIndex,
  deriveGridCells,
  round7,
  wrapLongitude,
  METERS_PER_LAT_DEGREE,
} from './geogrid.geometry.js';

/** Deterministic pseudo-random sequence — reproducible across runs. */
function* lcg(seed: number, count: number): Generator<number> {
  let state = seed;
  for (let index = 0; index < count; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state / 2_147_483_648;
  }
}

const CORNER_CENTERS = [
  { centerLat: 0, centerLng: 0 },
  { centerLat: GEOGRID_MAX_ABS_CENTER_LAT, centerLng: 0 },
  { centerLat: -GEOGRID_MAX_ABS_CENTER_LAT, centerLng: 0 },
  { centerLat: 51.5074, centerLng: -0.1278 },
  { centerLat: -33.8688, centerLng: 151.2093 },
  { centerLat: 0, centerLng: 179.9 },
  { centerLat: 0, centerLng: -179.9 },
  { centerLat: 0, centerLng: 180 },
  { centerLat: 0, centerLng: -180 },
];

const SPACINGS = [
  GEOGRID_MIN_SPACING_METERS,
  500,
  1_000,
  5_000,
  GEOGRID_MAX_SPACING_METERS,
];

function everyDefinition(): Array<{
  centerLat: number;
  centerLng: number;
  spacingMeters: number;
  gridSize: GeogridSize;
  zoom: number;
}> {
  const out = [];
  for (const center of CORNER_CENTERS) {
    for (const spacingMeters of SPACINGS) {
      for (const gridSize of GEOGRID_SIZES) {
        out.push({ ...center, spacingMeters, gridSize, zoom: 17 });
      }
    }
  }
  // Deterministic pseudo-random centres on top of the corners.
  const sequence = [...lcg(20260809, 60)];
  for (let index = 0; index + 1 < sequence.length; index += 2) {
    out.push({
      centerLat: round7((sequence[index]! * 2 - 1) * GEOGRID_MAX_ABS_CENTER_LAT),
      centerLng: round7((sequence[index + 1]! * 2 - 1) * 180),
      spacingMeters: 1_000,
      gridSize: 7 as GeogridSize,
      zoom: 17,
    });
  }
  return out;
}

describe('round7 / wrapLongitude', () => {
  it('rounds to at most seven decimals', () => {
    expect(round7(52.61785491234)).toBe(52.6178549);
    expect(round7(-0.00000004)).toBe(-0);
  });

  it('wraps longitude into (-180, 180]', () => {
    expect(wrapLongitude(0)).toBe(0);
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(-180)).toBe(180);
    expect(wrapLongitude(181)).toBe(-179);
    expect(wrapLongitude(-181)).toBe(179);
    expect(wrapLongitude(540)).toBe(180);
    expect(wrapLongitude(-540)).toBe(180);
  });
});

describe('deriveGridCells — pinned properties', () => {
  it('produces exactly gridSize² cells with a dense 0..n-1 index', () => {
    for (const definition of everyDefinition()) {
      const cells = deriveGridCells(definition);
      const expected = definition.gridSize * definition.gridSize;
      expect(cells).toHaveLength(expected);
      expect(cells.map((cell) => cell.pointIndex)).toEqual(
        Array.from({ length: expected }, (_, index) => index),
      );
    }
  });

  it('keeps every coordinate inside WGS84 range', () => {
    for (const definition of everyDefinition()) {
      for (const cell of deriveGridCells(definition)) {
        expect(cell.lat).toBeGreaterThanOrEqual(-90);
        expect(cell.lat).toBeLessThanOrEqual(90);
        expect(cell.lng).toBeGreaterThan(-180);
        expect(cell.lng).toBeLessThanOrEqual(180);
      }
    }
  });

  it('formats every derived coordinate to the vendor string', () => {
    const pattern = /^-?\d{1,3}(\.\d{1,7})?,-?\d{1,3}(\.\d{1,7})?,\d{1,2}z$/;
    for (const definition of everyDefinition()) {
      for (const cell of deriveGridCells(definition)) {
        expect(
          formatLocationCoordinate({ lat: cell.lat, lng: cell.lng, zoom: definition.zoom }),
        ).toMatch(pattern);
      }
    }
  });

  it('the centre cell is the input centre', () => {
    for (const definition of everyDefinition()) {
      const cells = deriveGridCells(definition);
      const centre = cells[centerPointIndex(definition.gridSize)]!;
      expect(centre.lat).toBe(round7(definition.centerLat));
      expect(centre.lng).toBe(round7(wrapLongitude(definition.centerLng)));
    }
  });

  it('orders rows north-first and columns west-first', () => {
    const cells = deriveGridCells({
      centerLat: 30,
      centerLng: 10,
      spacingMeters: 1_000,
      gridSize: 3,
      zoom: 17,
    });
    // Row 0 (north) is strictly above row 2 (south).
    expect(cells[0]!.lat).toBeGreaterThan(cells[6]!.lat);
    // Column 0 (west) is strictly left of column 2 (east) at a non-wrapping centre.
    expect(cells[0]!.lng).toBeLessThan(cells[2]!.lng);
    expect(cells[4]!).toMatchObject({ pointIndex: 4, row: 1, col: 1, lat: 30, lng: 10 });
  });

  it('spaces adjacent rows by exactly the requested metres', () => {
    const spacingMeters = 2_000;
    const cells = deriveGridCells({
      centerLat: 0,
      centerLng: 0,
      spacingMeters,
      gridSize: 3,
      zoom: 17,
    });
    const degrees = Math.abs(cells[0]!.lat - cells[3]!.lat);
    expect(degrees * METERS_PER_LAT_DEGREE).toBeCloseTo(spacingMeters, 2);
  });

  it('crosses the antimeridian instead of clamping', () => {
    const cells = deriveGridCells({
      centerLat: 0,
      centerLng: 179.99,
      spacingMeters: 10_000,
      gridSize: 7,
      zoom: 17,
    });
    expect(cells.some((cell) => cell.lng > 0)).toBe(true);
    expect(cells.some((cell) => cell.lng < 0)).toBe(true);
    for (const cell of cells) {
      expect(cell.lng).toBeGreaterThan(-180);
      expect(cell.lng).toBeLessThanOrEqual(180);
    }
  });

  it('never exceeds the 49-cell product ceiling', () => {
    for (const gridSize of GEOGRID_SIZES) {
      expect(gridSize * gridSize).toBeLessThanOrEqual(49);
    }
    expect(
      deriveGridCells({
        centerLat: 0,
        centerLng: 0,
        spacingMeters: 100,
        gridSize: 7,
        zoom: 17,
      }),
    ).toHaveLength(49);
  });

  it('centerPointIndex is the middle of every offered size', () => {
    expect(centerPointIndex(3)).toBe(4);
    expect(centerPointIndex(5)).toBe(12);
    expect(centerPointIndex(7)).toBe(24);
  });
});
