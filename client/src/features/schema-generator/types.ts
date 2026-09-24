/**
 * Client mirror of the schema-generator wire contract
 * (`server/src/modules/schema-generator/schema-generator.service.ts` DTOs).
 *
 * Nothing here re-decides a contract: the enums are copies of the server's
 * frozen registry so the pickers can render without a round trip, and the
 * `GET /types` projection is still the authority for property sets.
 */

export const SUPPORTED_SCHEMA_TYPES = [
  'WebPage',
  'WebSite',
  'Organization',
  'Article',
  'BreadcrumbList',
  'FAQPage',
  'HowTo',
] as const;
export type SupportedSchemaType = (typeof SUPPORTED_SCHEMA_TYPES)[number];

export function isSupportedSchemaType(value: unknown): value is SupportedSchemaType {
  return (
    typeof value === 'string' &&
    (SUPPORTED_SCHEMA_TYPES as readonly string[]).includes(value)
  );
}

export const EVIDENCE_SOURCES = ['audited-page', 'inventory-page', 'url'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const OMISSION_REASONS = [
  'no_evidence',
  'evidence_ambiguous',
  'not_applicable',
] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

export type SchemaPropertyClass = 'required' | 'recommended';

export interface SchemaPropertyProjection {
  name: string;
  class: SchemaPropertyClass;
  fill: 'deterministic' | 'ai-selected';
  evidenceFactIds: string[];
  neverFilled: boolean;
}

export interface SchemaTypeProjection {
  type: SupportedSchemaType;
  required: SchemaPropertyProjection[];
  recommended: SchemaPropertyProjection[];
}

export interface SchemaTypesResponse {
  registryVersion: string;
  types: SchemaTypeProjection[];
}

export interface AuditedSourcePage {
  url: string;
  title: string | null;
  hasStructuredData: boolean;
  structuredDataErrors: number;
  richResultsVerdict: string | null;
}

export interface InventorySourcePage {
  url: string;
  schemaTypes: string[];
  hasSchemaOrgArticle: boolean;
}

export interface SchemaSources {
  siteId: string;
  runId: string | null;
  auditedPages: AuditedSourcePage[];
  inventoryPages: InventorySourcePage[];
}

export interface EvidenceRow {
  property: string;
  factId: string;
  factLabel: string;
  value: string;
}

export interface OmissionRow {
  property: string;
  reasonCode: OmissionReason;
  class: SchemaPropertyClass;
}

export interface ConformanceGap {
  property: string;
  reasonCode: OmissionReason;
}

export interface ConformanceReport {
  registryVersion: string;
  status: 'conforms' | 'gaps';
  requiredGaps: ConformanceGap[];
  recommendedSuggestions: ConformanceGap[];
}

export type SchemaGenerationFailureReason = 'ai_provider_failed' | 'ai_output_rejected';

export interface GenerationSummary {
  id: string;
  siteId: string;
  pageUrl: string;
  source: EvidenceSource;
  schemaType: SupportedSchemaType;
  registryVersion: string;
  status: 'complete' | 'failed';
  conformanceStatus: 'conforms' | 'gaps' | null;
  failureReason: SchemaGenerationFailureReason | null;
  refunded: boolean;
  generatedAt: string;
}

export interface GenerationDetail extends GenerationSummary {
  /** Serialized JSON-LD. Rendered as a TEXT node only — never as markup. */
  payload: string | null;
  mediaType: string;
  evidence: EvidenceRow[];
  omissions: OmissionRow[];
  conformance: ConformanceReport | null;
}

/**
 * The server's advisory preview. This surface only needs to know a preview
 * arrived (the confirm button waits for it); it renders none of its fields.
 */
export type SchemaSpendPreview = Record<string, unknown>;

/** Honest refusal states. Every kind names a refusal the SERVER made. */
export const SCHEMA_GATE_KINDS = [
  'killSwitch',
  'notFound',
  'unsafeUrl',
  'rateLimited',
  'failed',
] as const;
export type SchemaGateKind = (typeof SCHEMA_GATE_KINDS)[number];

export interface SchemaGate {
  kind: SchemaGateKind;
  message: string;
}

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SchemaGeneratorFormState {
  source: EvidenceSource;
  pageUrl: string;
  schemaType: SupportedSchemaType;
}

export interface SchemaGeneratorState {
  siteId: string | null;
  registryVersion: string;
  types: SchemaTypeProjection[];
  typesStatus: RequestStatus;
  sources: SchemaSources | null;
  sourcesStatus: RequestStatus;
  sourcesGate: SchemaGate | null;
  generations: GenerationSummary[];
  listStatus: RequestStatus;
  listGate: SchemaGate | null;
  detail: GenerationDetail | null;
  detailStatus: RequestStatus;
  detailGate: SchemaGate | null;
  preview: SchemaSpendPreview | null;
  previewStatus: RequestStatus;
  previewGate: SchemaGate | null;
  generateStatus: RequestStatus;
  generateGate: SchemaGate | null;
  form: SchemaGeneratorFormState;
}

export const DEFAULT_SCHEMA_TYPE: SupportedSchemaType = 'WebPage';

export const initialSchemaGeneratorState: SchemaGeneratorState = {
  siteId: null,
  registryVersion: '',
  types: [],
  typesStatus: 'idle',
  sources: null,
  sourcesStatus: 'idle',
  sourcesGate: null,
  generations: [],
  listStatus: 'idle',
  listGate: null,
  detail: null,
  detailStatus: 'idle',
  detailGate: null,
  preview: null,
  previewStatus: 'idle',
  previewGate: null,
  generateStatus: 'idle',
  generateGate: null,
  form: { source: 'audited-page', pageUrl: '', schemaType: DEFAULT_SCHEMA_TYPE },
};
