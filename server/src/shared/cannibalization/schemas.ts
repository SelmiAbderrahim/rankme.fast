/**
 * Cannibalization candidate schema — promoted from the content-inventory
 * module so exactly one definition exists.
 */
import { z } from 'zod';
import { CANNIBALIZATION_CONFIDENCE_LEVELS } from './scoring.js';
export const cannibalizationCandidateSchema = z
    .object({
    id: z.string().min(1).max(128),
    query: z.string().min(1).max(400),
    urls: z.array(z.string().min(1).max(2048)).min(2).max(50),
    confidence: z.enum(CANNIBALIZATION_CONFIDENCE_LEVELS),
    /** Source ids backing the finding (gsc:<url>, rank:<keyword>, term:<url>). */
    evidenceSourceIds: z.array(z.string().min(1).max(256)).max(50),
    hasGscEvidence: z.boolean(),
})
    .strict();
export type CannibalizationCandidate = z.infer<typeof cannibalizationCandidateSchema>;
