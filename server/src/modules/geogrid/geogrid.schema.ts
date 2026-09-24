/**
 * Geogrid request validation.
 *
 * These bounds are the SEC-BOUND authority and they run BEFORE any scan row
 * is written: `gridSize` is a literal union, so an oversized grid
 * (9×9, 49×49) fails parsing in the controller and can never start a scan.
 */
import { z } from 'zod';
import { GEOGRID_MAX_ABS_CENTER_LAT, GEOGRID_MAX_SPACING_METERS, GEOGRID_MAX_ZOOM, GEOGRID_MIN_SPACING_METERS, GEOGRID_MIN_ZOOM, GEOGRID_DEFAULT_ZOOM, GEOGRID_SPACING_STEP_METERS, } from '../../db/schema/geogrid.js';
export const geogridCenterLatSchema = z
    .number()
    .finite()
    .min(-GEOGRID_MAX_ABS_CENTER_LAT)
    .max(GEOGRID_MAX_ABS_CENTER_LAT);
export const geogridCenterLngSchema = z.number().finite().min(-180).max(180);
export const geogridSpacingSchema = z
    .number()
    .int()
    .min(GEOGRID_MIN_SPACING_METERS)
    .max(GEOGRID_MAX_SPACING_METERS)
    .refine((value) => value % GEOGRID_SPACING_STEP_METERS === 0, {
    message: `spacingMeters must be a multiple of ${GEOGRID_SPACING_STEP_METERS}`,
});
/** Literal union — the clamp that runs before any scan row is written. */
export const geogridSizeSchema = z.union([
    z.literal(3),
    z.literal(5),
    z.literal(7),
]);
export const geogridZoomSchema = z
    .number()
    .int()
    .min(GEOGRID_MIN_ZOOM)
    .max(GEOGRID_MAX_ZOOM);
export const geogridDefinitionSchema = z.object({
    keywordId: z.string().uuid(),
    centerLat: geogridCenterLatSchema,
    centerLng: geogridCenterLngSchema,
    spacingMeters: geogridSpacingSchema,
    gridSize: geogridSizeSchema,
    zoom: geogridZoomSchema.default(GEOGRID_DEFAULT_ZOOM),
});
export type GeogridDefinitionInput = z.infer<typeof geogridDefinitionSchema>;
export const listGeogridScansQuerySchema = z.object({
    keywordId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const geogridSiteParamSchema = z.object({
    siteId: z.string().min(1),
});
export const geogridScanIdParamSchema = z.object({
    siteId: z.string().min(1),
    scanId: z.string().uuid(),
});
