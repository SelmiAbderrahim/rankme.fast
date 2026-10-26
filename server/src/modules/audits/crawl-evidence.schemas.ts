import mongoose from 'mongoose';
import { BROKEN_LINK_OUTCOMES, PAGE_FETCH_FAILURE_KINDS } from '../../shared/providers/types.js';

/**
 * Mongoose sub-schemas for crawl evidence, shared by
 * `AuditedPage` (per-page evidence) and `AuditRun` (coverage probes). Every
 * field mirrors a type in `shared/providers/types.ts`.
 */
export const redirectHopSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    status: { type: Number, required: true },
  },
  { _id: false },
);

export const fetchFailureSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: PAGE_FETCH_FAILURE_KINDS, required: true },
    statusCode: { type: Number, default: undefined },
    contentType: { type: String, default: undefined },
  },
  { _id: false },
);

export const brokenLinkEvidenceSchema = new mongoose.Schema(
  {
    target: { type: String, required: true },
    outcome: { type: String, enum: BROKEN_LINK_OUTCOMES, required: true },
    status: { type: Number, default: null },
    failure: { type: String, enum: PAGE_FETCH_FAILURE_KINDS, default: undefined },
    finalUrl: { type: String, default: undefined },
  },
  { _id: false },
);

export const coverageProbeSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    source: { type: String, enum: ['site-root', 'search-console'] as const, required: true },
    statusCode: { type: Number, default: null },
    finalUrl: { type: String, default: null },
    redirectChain: { type: [redirectHopSchema], default: [] },
    contentType: { type: String, default: null },
    failure: { type: fetchFailureSchema, default: null },
  },
  { _id: false },
);
