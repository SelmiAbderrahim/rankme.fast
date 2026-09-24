/**
 * Geogrid cell derivation.
 *
 * PURE and TOTAL: no clock, no randomness, no I/O. Given a validated grid
 * definition it returns exactly `gridSize²` cells in a stable order, so the
 * same definition always produces the same coordinates and the same
 * `pointIndex` render keys.
 *
 * Ordering is ROW-MAJOR FROM THE NORTH-WEST CORNER:
 *
 *     row 0 → northernmost      col 0 → westernmost
 *     pointIndex = row * gridSize + col
 *
 * The client lays cells out with `row = floor(idx / size)`, `col = idx % size`.
 * Arabic RTL flips only the visual column order (a `dir`-aware container),
 * never `pointIndex` — the persistence key is direction-independent.
 */
import type { GeogridSize } from '../../db/schema/geogrid.js';
/** WGS84 mean length of one degree of latitude, in metres. */
export const METERS_PER_LAT_DEGREE = 111320;
export interface GeogridDefinition {
    centerLat: number;
    centerLng: number;
    spacingMeters: number;
    gridSize: GeogridSize;
    zoom: number;
}
export interface GeogridCell {
    /** 0-based, row-major from the north-west corner. */
    pointIndex: number;
    /** 0-based row, 0 = northernmost. */
    row: number;
    /** 0-based column, 0 = westernmost. */
    col: number;
    lat: number;
    lng: number;
}
/** Round to the vendor's documented seven-decimal ceiling. */
export function round7(value: number): number {
    return Math.round(value * 1e7) / 1e7;
}
/**
 * Wrap any real longitude into `(-180, 180]`, so an antimeridian-crossing
 * grid is a valid grid rather than a rejected one.
 */
export function wrapLongitude(value: number): number {
    const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
}
/**
 * Derive every cell of the grid.
 *
 * Latitude can never leave range: the largest offset is
 * `3 × 10_000 / 111_320 = 0.2695°` and the validated centre is bounded to
 * `|lat| ≤ 85`, so `|lat| ≤ 85.27`. Longitude is wrapped, so it is always in
 * range by construction.
 */
export function deriveGridCells(definition: GeogridDefinition): GeogridCell[] {
    const { centerLat, centerLng, spacingMeters, gridSize } = definition;
    const half = (gridSize - 1) / 2;
    const latRad = (centerLat * Math.PI) / 180;
    const lngScale = Math.cos(latRad);
    const cells: GeogridCell[] = [];
    for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
            const northMeters = (half - row) * spacingMeters;
            const eastMeters = (col - half) * spacingMeters;
            const lat = round7(centerLat + northMeters / METERS_PER_LAT_DEGREE);
            const lng = round7(wrapLongitude(centerLng + eastMeters / METERS_PER_LAT_DEGREE / lngScale));
            cells.push({ pointIndex: row * gridSize + col, row, col, lat, lng });
        }
    }
    return cells;
}
/** `pointIndex` of the centre cell — always present because sizes are odd. */
export function centerPointIndex(gridSize: GeogridSize): number {
    return (gridSize * gridSize - 1) / 2;
}
