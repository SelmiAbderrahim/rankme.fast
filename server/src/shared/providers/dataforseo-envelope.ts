/**
 * DataForSEO response envelope: `{ status_code, tasks: [{ status_code,
 * result }] }` — status codes live at BOTH levels and http.ts branches on
 * both. `result` stays `unknown` here; each adapter validates it with its
 * own per-operation schema.
 */
import { z } from 'zod';
export const zodDataForSeoTask = z.object({
    id: z.string().optional(),
    status_code: z.number(),
    status_message: z.string().optional(),
    cost: z.number().nullable().optional(),
    result: z.unknown().optional(),
});
export const zodDataForSeoEnvelope = z.object({
    status_code: z.number(),
    status_message: z.string().optional(),
    cost: z.number().nullable().optional(),
    tasks: z.array(zodDataForSeoTask).nullish(),
});
export type DataForSeoEnvelope = z.infer<typeof zodDataForSeoEnvelope>;
export type DataForSeoTask = z.infer<typeof zodDataForSeoTask>;
