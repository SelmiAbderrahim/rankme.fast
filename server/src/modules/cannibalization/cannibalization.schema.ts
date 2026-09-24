/**
 * Request + response schemas for cannibalization reports.
 * SEC-BOUND / SEC-INJECT: every attacker-influenced field is zod-bounded here
 * before it reaches a query or a stored document.
 */
import { z } from 'zod';
/** Windows the GSC sync persists (`GSC_RANGE_WINDOWS`). */
export const CANNIBALIZATION_WINDOWS = [7, 28, 90] as const;
export type CannibalizationWindow = (typeof CANNIBALIZATION_WINDOWS)[number];
export const DEFAULT_CANNIBALIZATION_WINDOW: CannibalizationWindow = 28;
/** Server-enforced result bounds (SEC-BOUND). */
export const MAX_CANDIDATES = 200;
export const MAX_PAGES_PER_QUERY = 20;
const objectIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'validation.issue.invalidString');
export const siteIdParamsSchema = z.object({ siteId: objectIdSchema }).strict();
export const reportIdParamsSchema = z.object({ reportId: objectIdSchema }).strict();
const windowSchema = z
    .union([z.literal(7), z.literal(28), z.literal(90)])
    .default(DEFAULT_CANNIBALIZATION_WINDOW);
/**
 * `.default({})` makes an absent body parse to the default window, so the
 * controller never needs its own `?? {}` fallback.
 */
export const generateReportBodySchema = z
    .object({ windowDays: windowSchema })
    .strict()
    .default({});
export type GenerateReportBody = z.infer<typeof generateReportBodySchema>;
export const previewReportBodySchema = generateReportBodySchema;
export const listReportsQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    // Query-string values arrive as strings — coerce before the literal union.
    windowDays: z.coerce
        .number()
        .refine((v): v is CannibalizationWindow => (CANNIBALIZATION_WINDOWS as readonly number[]).includes(v), { message: 'validation.custom.analysisWindowInvalid' })
        .optional(),
})
    .strict();
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
