/**
 * Feature-scoped fetch wrappers for `/api/schema-generator`.
 * Thin by design: every call goes through the shared `apiClient`, which owns
 * `credentials: 'include'`, the CSRF echo and the localized 401 toast.
 */
import { apiClient } from '@shared/api/client';
import type {
  EvidenceSource,
  GenerationDetail,
  GenerationSummary,
  SchemaSources,
  SchemaSpendPreview,
  SchemaTypesResponse,
  SupportedSchemaType,
} from './types';

export const fetchSchemaTypes = (
  init: { signal?: AbortSignal } = {},
): Promise<SchemaTypesResponse> =>
  apiClient<SchemaTypesResponse>(
    '/schema-generator/types',
    init.signal ? { signal: init.signal } : {},
  );

export const fetchSchemaSources = (
  siteId: string,
  init: { signal?: AbortSignal } = {},
): Promise<SchemaSources> =>
  apiClient<SchemaSources>(
    `/schema-generator/sources?siteId=${encodeURIComponent(siteId)}`,
    init.signal ? { signal: init.signal } : {},
  );

export interface GenerationRequest {
  siteId: string;
  source: EvidenceSource;
  pageUrl: string;
  schemaType: SupportedSchemaType;
}

export const previewSchemaGeneration = (
  request: GenerationRequest,
): Promise<SchemaSpendPreview> =>
  apiClient<SchemaSpendPreview>('/schema-generator/preview', {
    method: 'POST',
    body: {
      siteId: request.siteId,
      source: request.source,
      pageUrl: request.pageUrl,
      schemaType: request.schemaType,
    },
  });

export const createSchemaGeneration = (
  request: GenerationRequest,
): Promise<GenerationDetail> =>
  apiClient<GenerationDetail>('/schema-generator/generations', {
    method: 'POST',
    body: request,
    // Browser 60s > web proxy 55s > bounded AI profile 50s.
    timeoutMs: 60_000,
  });

export const fetchSchemaGenerations = (
  siteId: string,
  init: { signal?: AbortSignal } = {},
): Promise<{ items: GenerationSummary[] }> =>
  apiClient<{ items: GenerationSummary[] }>(
    `/schema-generator/generations?siteId=${encodeURIComponent(siteId)}`,
    init.signal ? { signal: init.signal } : {},
  );

export const fetchSchemaGeneration = (
  generationId: string,
  init: { signal?: AbortSignal } = {},
): Promise<GenerationDetail> =>
  apiClient<GenerationDetail>(
    `/schema-generator/generations/${encodeURIComponent(generationId)}`,
    init.signal ? { signal: init.signal } : {},
  );

/**
 * The stored payload verbatim, served as `application/ld+json`. `apiClient`
 * returns it as TEXT because the media type is not `application/json` — the
 * markup is never re-parsed or rebuilt on the client (SEC-OUT).
 */
export const downloadSchemaGeneration = (generationId: string): Promise<string> =>
  apiClient<string>(
    `/schema-generator/generations/${encodeURIComponent(generationId)}/download`,
    {
      localeMode: 'artifact',
      allowLegacyNullContentLanguage: true,
      headers: { Accept: 'application/ld+json' },
    },
  );

// names these six feature calls without a prefix. Keep the explicit
// schema-prefixed names above for existing consumers while exposing the frozen
// contract names as aliases (one implementation, no drift).
export {
  createSchemaGeneration as createGeneration,
  fetchSchemaGeneration as fetchGeneration,
  fetchSchemaGenerations as fetchGenerations,
  fetchSchemaSources as fetchSources,
  fetchSchemaTypes as fetchTypes,
  previewSchemaGeneration as previewGeneration,
};
