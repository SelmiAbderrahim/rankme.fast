import { z } from 'zod';
import { sanitizeTranslationVars } from '../../../shared/i18n/errors.js';
import type { AppProfileDocument } from '../app-profile.model.js';
import type { AppInfo, AppStoreKind } from '../../../shared/providers/app-data.js';
export const APP_LISTING_ENGINE_VERSION = 'app-listing-rules-2026-08-10' as const;
export const listingRuleStatusSchema = z.enum(['finding', 'passed', 'notEvaluated']);
export const listingSeveritySchema = z.enum(['fixNow', 'watch', 'advisory']);
export const listingScopeSchema = z.enum(['google_play', 'app_store', 'parity']);
const listingCopyVarNameSchema = z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/)
    .refine((value) => !['constructor', 'prototype'].includes(value), 'Unsafe copy variable name');
const listingCopyVarStringSchema = z
    .string()
    .min(1)
    .max(200)
    .refine((value) => sanitizeTranslationVars({ value })?.value === value, 'Unsafe copy variable value');
export const listingFindingSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    scope: listingScopeSchema,
    status: listingRuleStatusSchema,
    severity: listingSeveritySchema,
    copyKey: z.string().regex(/^appSeo\.listing\.findings\.[a-z0-9-]+$/),
    params: z
        .record(listingCopyVarNameSchema, z.union([listingCopyVarStringSchema, z.number().finite()]))
        .refine((value) => Object.keys(value).length <= 16, 'Too many copy variables'),
    provenance: z.enum(['store-observation', 'user-paired']),
}).strict();
export type ListingFinding = z.infer<typeof listingFindingSchema>;
export const listingNotObservedNoteSchema = z.object({
    store: z.enum(['google_play', 'app_store']),
    field: z.enum(['listing', 'shortDescription', 'subtitle', 'screenshots', 'installs']),
    copyKey: z.string().regex(/^appSeo\.listing\.notObserved\.[a-zA-Z0-9]+$/),
}).strict();
export type ListingNotObservedNote = z.infer<typeof listingNotObservedNoteSchema>;
export const listingEngineOutputSchema = z.object({
    findings: z.array(listingFindingSchema),
    notObserved: z.array(listingNotObservedNoteSchema),
    engineVersion: z.literal(APP_LISTING_ENGINE_VERSION),
}).strict();
export type ListingEngineOutput = z.infer<typeof listingEngineOutputSchema>;
export interface ListingProfileInput {
    paired: boolean;
    playPackageId: string | null;
    appStoreId: string | null;
}
export interface ListingEngineInput {
    profile: ListingProfileInput | Pick<AppProfileDocument, 'paired' | 'playPackageId' | 'appStoreId'>;
    byStore: Record<AppStoreKind, AppInfo | null>;
    trackedPhrases: string[];
}
export interface NormalizedListingInput {
    store: AppStoreKind;
    title: string;
    shortDescription: string | null;
    subtitle: string | null;
    description: string | null;
    rating: number | null;
    screenshotCount: number | null;
    installLowerBound: number | null;
    categories: string[];
    updatedAt: string | null;
    observedAt: string;
}
export type ListingRule = (input: NormalizedListingInput, trackedPhrases: readonly string[]) => ListingFinding[];
