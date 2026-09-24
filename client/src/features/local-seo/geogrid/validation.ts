/**
 * Client mirror of `server/src/modules/geogrid/geogrid.schema.ts`.
 *
 * This blocks an obviously-invalid submit so the user gets an inline field
 * error instead of a round trip. It is NOT the authority: the server re-runs
 * every bound, and the clamp still happens before any reservation.
 */
import { z } from 'zod';
import {
  GEOGRID_MAX_ABS_CENTER_LAT,
  GEOGRID_MAX_SPACING_METERS,
  GEOGRID_MAX_ZOOM,
  GEOGRID_MIN_SPACING_METERS,
  GEOGRID_MIN_ZOOM,
  GEOGRID_SPACING_STEP_METERS,
  type GeogridDefinition,
  type GeogridFormState,
} from './types';

export const geogridDefinitionSchema = z.object({
  keywordId: z.string().uuid(),
  centerLat: z
    .number()
    .finite()
    .min(-GEOGRID_MAX_ABS_CENTER_LAT)
    .max(GEOGRID_MAX_ABS_CENTER_LAT),
  centerLng: z.number().finite().min(-180).max(180),
  spacingMeters: z
    .number()
    .int()
    .min(GEOGRID_MIN_SPACING_METERS)
    .max(GEOGRID_MAX_SPACING_METERS)
    .refine((value) => value % GEOGRID_SPACING_STEP_METERS === 0),
  gridSize: z.union([z.literal(3), z.literal(5), z.literal(7)]),
  zoom: z.number().int().min(GEOGRID_MIN_ZOOM).max(GEOGRID_MAX_ZOOM),
});

export type GeogridFieldError = 'keywordId' | 'centerLat' | 'centerLng' | 'spacingMeters' | 'zoom';

export interface GeogridFormValidation {
  definition: GeogridDefinition | null;
  errors: GeogridFieldError[];
}

/** Coordinate fields are free text so a partially-typed value is not clobbered. */
function parseCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function validateGeogridForm(form: GeogridFormState): GeogridFormValidation {
  const errors: GeogridFieldError[] = [];
  const centerLat = parseCoordinate(form.centerLat);
  const centerLng = parseCoordinate(form.centerLng);
  if (!form.keywordId) errors.push('keywordId');
  if (centerLat === null || Math.abs(centerLat) > GEOGRID_MAX_ABS_CENTER_LAT) {
    errors.push('centerLat');
  }
  if (centerLng === null || Math.abs(centerLng) > 180) errors.push('centerLng');
  if (
    !Number.isInteger(form.spacingMeters) ||
    form.spacingMeters < GEOGRID_MIN_SPACING_METERS ||
    form.spacingMeters > GEOGRID_MAX_SPACING_METERS ||
    form.spacingMeters % GEOGRID_SPACING_STEP_METERS !== 0
  ) {
    errors.push('spacingMeters');
  }
  if (
    !Number.isInteger(form.zoom) ||
    form.zoom < GEOGRID_MIN_ZOOM ||
    form.zoom > GEOGRID_MAX_ZOOM
  ) {
    errors.push('zoom');
  }
  if (errors.length > 0) return { definition: null, errors };
  const candidate = {
    keywordId: form.keywordId,
    centerLat: centerLat as number,
    centerLng: centerLng as number,
    spacingMeters: form.spacingMeters,
    gridSize: form.gridSize,
    zoom: form.zoom,
  };
  const parsed = geogridDefinitionSchema.safeParse(candidate);
  return parsed.success
    ? { definition: parsed.data, errors: [] }
    : { definition: null, errors: ['keywordId'] };
}
