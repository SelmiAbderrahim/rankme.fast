/** Supported evidence sources shared by schemas, storage and assembly. */
export const EVIDENCE_SOURCES = ['audited-page', 'inventory-page', 'url'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
