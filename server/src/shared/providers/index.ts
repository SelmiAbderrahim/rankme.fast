/**
 * Public API of the provider layer. Feature modules import from
 * here (types, errors, registry, fakes) — never from a vendor client file.
 */
export * from './types.js';
export * from './domain-comparison.js';
export * from './app-data.js';
export * from './serp-features.js';
export * from './serp-normalization.js';
export * from './errors.js';
export * from './fakes.js';
export * from './content-source.js';
export * from './content-source-fake.js';
export * from './content-monitor.js';
export * from './content-monitor-fake.js';
export * from './ai-generation.js';
export * from './ai-generation-fake.js';
export * from './ai-chat.js';
export * from './ai-chat-fake.js';
export * from './email.js';
export { getResendTransport, isEmailTransportConfigured, sendEmail, setResendTransport, } from './email-registry.js';
export { buildAiSdkAdaptersFromEnv, createAiGenerationProviderFromEnv, getAiGenerationProvider, } from './ai-generation-registry.js';
export { createAiChatProviderFromEnv, type AiChatRegistryDependencies, } from './ai-chat-registry.js';
export { buildChatSdkTools, callChatAiSdk, createAiSdkChatProvider, type AiChatSdkCall, type AiChatSdkCallInput, type AiSdkChatRuntimeConfig, type RawChatStreamPart, } from './ai-sdk/chat-runtime.js';
export { captureVendorCost, recordVendorCostUsd, usdToMicros } from './cost-capture.js';
export { FIRECRAWL_CREDENTIAL_REF_PATTERN, firecrawlCredentialRef, } from './firecrawl-credential-ref.js';
export { MAX_ALT_ENGINE_ROWS, buildAltEngineObservationMeta, matchHostInRows, matchTokenInRows, normalizeAsin, normalizeChannelHandle, } from './dataforseo/alt-engines.js';
export { normalizeCompetitorDomain, normalizeSerpKeywords, stripWwwPrefix, SERP_COMPETITORS_MAX_KEYWORDS, } from './dataforseo/labs-competitors.js';
export * from './summary/index.js';
export { createProviderRegistry, providerSelectionFromEnv, providerSelectionSchema, } from './registry.js';
export type { ProviderRegistry, ProviderSelection, ProviderSelectionEnv } from './registry.js';
