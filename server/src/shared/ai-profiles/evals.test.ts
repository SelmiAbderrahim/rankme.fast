import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  AiBudgetRefusalError,
  AiMalformedOutputError,
  AiSafetyError,
  type AiAttempt,
  type AiGenerationProvider,
  type AiGenerationResult,
  type GenerateStructuredInput,
} from '../providers/ai-generation.js';
import { lintFixtureText } from '../testing/fixtures/fixture-lint.js';
import { resolveAiTaskProfile } from './profiles.js';
import { createAiProfileRunner } from './runner.js';
import { INITIAL_AI_PROFILE_NAMES, type InitialAiProfileName } from './types.js';

const fixtureSchema = z.object({
  profile: z.enum(INITIAL_AI_PROFILE_NAMES),
  valid: z.object({ input: z.record(z.unknown()), locale: z.string(), output: z.record(z.unknown()) }),
  injection: z.string(),
  inventedCitation: z.string(),
  excessiveInput: z.object({ path: z.string(), characters: z.number().int().positive() }),
  wrongLocale: z.string(),
  malformed: z.record(z.unknown()),
  vendorFailover: z.tuple([z.string(), z.literal('success')]),
  budgetRefusal: z.literal(true),
  safetyRefusal: z.literal(true),
}).strict();

type EvalFixture = z.infer<typeof fixtureSchema>;
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../testing/fixtures/ai-profiles',
);

function loadFixture(profile: InitialAiProfileName): EvalFixture {
  const text = readFileSync(join(fixtureRoot, profile, 'evals.json'), 'utf8');
  expect(lintFixtureText(text)).toEqual([]);
  return fixtureSchema.parse(JSON.parse(text));
}

function attempt(
  ordinal: number,
  status: AiAttempt['status'],
  provider: 'google' | 'openai' = 'openai',
): AiAttempt {
  return {
    ordinal, provider, model: `${provider}-fixture`, status, latencyMs: 1,
    tokens: { input: 2, output: 1, cachedInput: null, reasoning: null },
    configuredEstimateCostMicros: 1n, actualOrEstimatedCostMicros: 1n,
    costSource: 'actual',
    errorCategory: status === 'timeout' ? 'timeout' : null,
    errorCode: status === 'timeout' ? 'provider_timeout' : null,
  };
}

function result(object: object, attempts: readonly AiAttempt[] = [attempt(1, 'success')]): AiGenerationResult<object> {
  return {
    trust: 'untrusted', object, provider: 'openai', model: 'openai-fixture',
    finishReason: 'stop',
    tokens: { input: 2, output: 1, cachedInput: null, reasoning: null },
    latencyMs: attempts.length, attempts, configuredEstimateCostMicros: 1n,
    actualCostMicros: 1n, actualOrEstimatedCostMicros: 1n, warnings: [],
  };
}

function request(fixture: EvalFixture, input = fixture.valid.input, locale = fixture.valid.locale) {
  return {
    profile: fixture.profile,
    input,
    locale,
    correlationId: `eval-${fixture.profile}`,
    usage: { accountId: 'eval-account' },
    configuredProviderOrder: ['openai'] as const,
  };
}

function providerFor(object: object, attempts?: readonly AiAttempt[]) {
  const generateStructured = vi.fn(async () => result(object, attempts));
  return { provider: { generateStructured } as AiGenerationProvider, generateStructured };
}

function setPath(source: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const clone = structuredClone(source);
  const segments = path.split('.');
  let current: unknown = clone;
  for (const segment of segments.slice(0, -1)) {
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  const last = segments.at(-1)!;
  if (Array.isArray(current)) current[Number(last)] = value;
  else (current as Record<string, unknown>)[last] = value;
  return clone;
}

const structuralFields = new Set(['id', 'ruleId', 'siteDomain', 'domain']);

function injectText(value: unknown, injection: string, property = ''): unknown {
  if (typeof value === 'string') {
    return structuralFields.has(property) ? value : `${value} ${injection}`;
  }
  if (Array.isArray(value)) return value.map((item) => injectText(item, injection, property));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      injectText(child, injection, key),
    ]));
  }
  return value;
}

describe('initial AI profile synthetic eval corpus', () => {
  it.each(INITIAL_AI_PROFILE_NAMES)('%s fixture has every required case and valid schemas', (name) => {
    const fixture = loadFixture(name);
    const profile = resolveAiTaskProfile(name);
    expect(profile.inputSchema.parse(fixture.valid.input)).toEqual(fixture.valid.input);
    expect(profile.outputSchema.parse(fixture.valid.output)).toEqual(fixture.valid.output);
    expect(fixture.vendorFailover[1]).toBe('success');
    expect(fixture.budgetRefusal).toBe(true);
    expect(fixture.safetyRefusal).toBe(true);
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s ignores injection strings in every prose field', async (name) => {
    const fixture = loadFixture(name);
    let captured: GenerateStructuredInput<object> | undefined;
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>(input: GenerateStructuredInput<T>) {
        captured = input as GenerateStructuredInput<object>;
        return result(fixture.valid.output) as AiGenerationResult<T>;
      },
    };
    const output = await createAiProfileRunner({ provider }).run(request(
      fixture,
      injectText(fixture.valid.input, fixture.injection) as Record<string, unknown>,
    ));
    expect(resolveAiTaskProfile(name).outputSchema.parse(output.object)).toEqual(output.object);
    expect(JSON.stringify(output.object)).not.toContain('system prompt');
    expect(JSON.stringify(output.object)).not.toContain('hidden configuration');
    expect(captured?.systemInstruction.text).not.toContain(fixture.injection);
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s rejects invented citations as explicit partial output', async (name) => {
    const fixture = loadFixture(name);
    const forged = { ...fixture.valid.output, citations: [fixture.inventedCitation] };
    const { provider } = providerFor(forged);
    const output = await createAiProfileRunner({ provider }).run(request(fixture));
    expect(output.status).toBe('partial');
    expect((output.object as { citations: string[] }).citations).toEqual([]);
    expect(output.warnings).toContain('citation_rejected');
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s truncates excessive input and flags it', async (name) => {
    const fixture = loadFixture(name);
    const oversized = setPath(
      fixture.valid.input,
      fixture.excessiveInput.path,
      'repeat '.repeat(fixture.excessiveInput.characters),
    );
    const { provider } = providerFor(fixture.valid.output);
    const output = await createAiProfileRunner({ provider }).run(request(fixture, oversized));
    expect(output.warnings).toContain('input_truncated');
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s rejects the fixture wrong locale before generation', async (name) => {
    const fixture = loadFixture(name);
    const { provider, generateStructured } = providerFor(fixture.valid.output);
    await expect(createAiProfileRunner({ provider }).run(request(
      fixture,
      fixture.valid.input,
      fixture.wrongLocale,
    ))).rejects.toMatchObject({ category: 'invalid_input' });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s rejects malformed structured output without prose fallback', async (name) => {
    const fixture = loadFixture(name);
    const { provider } = providerFor(fixture.malformed);
    await expect(createAiProfileRunner({ provider }).run(request(fixture)))
      .rejects.toBeInstanceOf(AiMalformedOutputError);
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s exposes vendor failover in provenance', async (name) => {
    const fixture = loadFixture(name);
    const attempts = [attempt(1, 'timeout', 'google'), attempt(2, 'success', 'openai')];
    const { provider } = providerFor(fixture.valid.output, attempts);
    const output = await createAiProfileRunner({ provider }).run({
      ...request(fixture), configuredProviderOrder: ['google', 'openai'],
    });
    expect(output.provenance.fallbackUsed).toBe(true);
    expect(output.qualityFlags).toContain('provider_fallback');
  });

  it.each(INITIAL_AI_PROFILE_NAMES)('%s propagates budget and safety refusals honestly', async (name) => {
    const fixture = loadFixture(name);
    for (const error of [new AiBudgetRefusalError(), new AiSafetyError()]) {
      const provider: AiGenerationProvider = { async generateStructured() { throw error; } };
      await expect(createAiProfileRunner({ provider }).run(request(fixture))).rejects.toBe(error);
    }
  });
});
