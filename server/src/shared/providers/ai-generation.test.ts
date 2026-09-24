import { describe, expect, it } from 'vitest';
import {
  AI_ERROR_CATEGORIES,
  AI_PROVIDER_KEYS,
  AI_SAFE_ERROR_CODES,
  AiAuthError,
  AiAvailabilityError,
  AiBudgetRefusalError,
  AiGenerationError,
  AiInvalidInputError,
  AiMalformedOutputError,
  AiQuotaError,
  AiSafetyError,
  AiTimeoutError,
} from './ai-generation.js';

describe('AI generation contract', () => {
  it('locks the ordered provider keys and fixed safe taxonomies', () => {
    expect(AI_PROVIDER_KEYS).toEqual([
      'glm',
      'deepseek',
      'kimi',
      'openai',
      'google',
      'anthropic',
    ]);
    expect(AI_ERROR_CATEGORIES).toHaveLength(8);
    expect(AI_SAFE_ERROR_CODES).toContain('account_budget_circuit_open');
  });

  it.each([
    [new AiAvailabilityError(), 'availability', 'provider_unavailable', true],
    [new AiAvailabilityError('provider_transport'), 'availability', 'provider_transport', true],
    [new AiQuotaError(), 'quota', 'provider_quota', true],
    [new AiTimeoutError(), 'timeout', 'provider_timeout', true],
    [new AiMalformedOutputError(), 'malformed_output', 'provider_malformed_output', true],
    [new AiAuthError(), 'auth', 'provider_auth', false],
    [new AiSafetyError(), 'safety', 'provider_safety', false],
    [new AiInvalidInputError(), 'invalid_input', 'invalid_generation_input', false],
    [new AiInvalidInputError('request_cancelled'), 'invalid_input', 'request_cancelled', false],
    [new AiBudgetRefusalError(), 'budget_refusal', 'request_budget_exhausted', false],
    [new AiBudgetRefusalError('account_budget_circuit_open'), 'budget_refusal', 'account_budget_circuit_open', false],
    [new AiTimeoutError('global_deadline_exceeded'), 'timeout', 'global_deadline_exceeded', false],
  ] as const)('normalizes %s without vendor prose', (error, category, code, retryable) => {
    expect(error).toBeInstanceOf(AiGenerationError);
    expect(error.name).toBe(error.constructor.name);
    expect(error.message).toBe(code);
    expect(error).toMatchObject({ category, code, retryable });
  });

  it('retains only the standard cause channel for internal diagnosis', () => {
    const cause = new Error('never expose this vendor prose');
    const error = new AiAuthError({ cause });
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('provider_auth');
  });
});
