/**
 * Unit-level coverage for the seams the router suite cannot reach: the
 * injectable holders, the controller's unauthenticated guard, and the
 * service's preflight ordering and defaults.
 */
import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { AuditRun, AuditedPage } from '../audits/index.js';
import { ContentInventoryPage } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { createGeneration, listSources } from './schema-generator.service.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getSchemaGeneratorAiProviderOrder,
  getSchemaGeneratorAiRunner,
  getSchemaGeneratorFetch,
  setSchemaGeneratorAiRunner,
  setSchemaGeneratorFetch,
} from './schema-generator.holder.js';
import {
  createGenerationController,
  downloadGenerationController,
  getGenerationController,
  getSourcesController,
  listGenerationsController,
  previewGenerationController,
} from './schema-generator.controller.js';

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = false;
  setSchemaGeneratorAiRunner(null, ['fake']);
  setSchemaGeneratorFetch(null);
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = true;
});

describe('holders', () => {

  it('throws a loud, actionable error when the AI runner was never wired', () => {
    setSchemaGeneratorAiRunner(null, ['fake']);
    expect(() => getSchemaGeneratorAiRunner()).toThrow(/setSchemaGeneratorAiRunner/u);
  });

  it('never accepts an empty provider order', () => {
    const runner = { preflight: () => undefined, run: async () => ({}) } as never;
    setSchemaGeneratorAiRunner(runner, []);
    expect(getSchemaGeneratorAiProviderOrder()).toEqual(['fake']);
    setSchemaGeneratorAiRunner(runner, ['openai']);
    expect(getSchemaGeneratorAiProviderOrder()).toEqual(['openai']);
    // The default parameter is the keyless order.
    setSchemaGeneratorAiRunner(runner);
    expect(getSchemaGeneratorAiProviderOrder()).toEqual(['fake']);
    setSchemaGeneratorAiRunner(null, ['fake']);
  });

  it('leaves the outbound transport unset in production', () => {
    setSchemaGeneratorFetch(null);
    expect(getSchemaGeneratorFetch()).toBeNull();
  });
});

describe('controller session guard', () => {
  const invoke = (
    handler: (req: Request, res: Response, next: NextFunction) => unknown,
  ): Promise<unknown> =>
    new Promise((resolve) => {
      handler(
        { params: {}, query: {}, body: {} } as unknown as Request,
        { status: () => ({ json: () => undefined }) } as unknown as Response,
        resolve as NextFunction,
      );
    });

  it.each([
    ['sources', getSourcesController],
    ['preview', previewGenerationController],
    ['create', createGenerationController],
    ['list', listGenerationsController],
    ['detail', getGenerationController],
    ['download', downloadGenerationController],
  ])('rejects a %s request that carries no resolved session', async (_label, handler) => {
    const error = await invoke(handler as never);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(401);
  });
});

describe('service defaults', () => {
  it('finishes the evidence preflight before calling the AI runner', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://missing-page.test',
      domain: 'missing-page.test',
      displayName: 'Missing Page Co',
    });
    const runAi = vi.fn();

    await expect(
      createGeneration(
        {
          accountId,
          siteId: String(site._id),
          source: 'audited-page',
          pageUrl: 'https://missing-page.test/not-crawled',
          schemaType: 'WebPage',
        },
        {
          ai: { preflight: () => undefined, run: runAi } as never,
          aiProviderOrder: ['fake'],
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(runAi).not.toHaveBeenCalled();
  });

  it('preflights the bounded AI request before running it', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://preflight.test',
      domain: 'preflight.test',
      displayName: 'Preflight Co',
    });
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      siteId: site._id,
      status: 'succeeded',
      pageCap: 25,
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://preflight.test/page',
      statusCode: 200,
      title: 'Preflight page',
      h1: ['Preflight page'],
      onPageScore: 70,
    });
    const runAi = vi.fn();
    const preflightInputs: Array<{ locale?: string; input?: unknown }> = [];

    await expect(
      createGeneration(
        {
          accountId,
          siteId: String(site._id),
          source: 'audited-page',
          pageUrl: 'https://preflight.test/page',
          schemaType: 'WebPage',
          outputLocale: 'fr',
        },
        {
          ai: {
            preflight: (input: { locale?: string; input?: unknown }) => {
              preflightInputs.push(input);
              throw new Error('invalid assembled AI request');
            },
            run: runAi,
          } as never,
          aiProviderOrder: ['fake'],
        },
      ),
    ).rejects.toThrow('invalid assembled AI request');
    expect(runAi).not.toHaveBeenCalled();
    expect(preflightInputs[0]?.locale).toBe('fr');
    expect(JSON.stringify(preflightInputs[0]?.input)).not.toContain('page.language');
  });

  it('generates with no caller locale and no injected transport', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://defaults.test',
      domain: 'defaults.test',
      displayName: 'Defaults Co',
    });
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      siteId: site._id,
      status: 'succeeded',
      pageCap: 25,
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://defaults.test/page',
      statusCode: 200,
      title: 'Defaults page',
      metaDescription: 'Defaults description.',
      h1: ['Defaults page'],
      h2: [],
      canonical: null,
      onPageScore: 70,
    });

    const runner = createAiProfileRunner({ provider: createFakeAiGenerationProvider() });
    let correlationId = '';
    const result = await createGeneration(
      {
        accountId,
        siteId: String(site._id),
        source: 'audited-page',
        pageUrl: 'https://defaults.test/page',
        schemaType: 'WebPage',
      },
      {
        ai: {
          preflight: runner.preflight,
          run: async (input) => {
            correlationId = input.correlationId;
            return runner.run(input);
          },
        },
        aiProviderOrder: ['fake'],
      },
    );
    expect(result.status).toBe('complete');
    expect(correlationId).toBe(`schema-generation:${result.id}`);
    // No stored locale and no fetched `<html lang>` — so `inLanguage` is an
    // honest recommended gap rather than a guess.
    expect(
      result.conformance?.recommendedSuggestions.map((gap) => gap.property),
    ).toContain('inLanguage');
  });

  it('deduplicates inventory rows by URL and tolerates a malformed facts blob', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      url: 'https://inventory.test',
      domain: 'inventory.test',
      displayName: 'Inventory Co',
    });
    const base = {
      accountId: new mongoose.Types.ObjectId(accountId),
      siteId: site._id,
      url: 'https://inventory.test/page',
      createdAtMs: Date.now(),
    };
    await ContentInventoryPage.create({
      ...base,
      runId: new mongoose.Types.ObjectId(),
      contentHash: 'newest',
      facts: { schemaTypes: [], hasSchemaOrgArticle: false },
    });
    await ContentInventoryPage.create({
      ...base,
      runId: new mongoose.Types.ObjectId(),
      contentHash: 'older',
      facts: { schemaTypes: [], hasSchemaOrgArticle: false },
    });
    await ContentInventoryPage.create({
      ...base,
      runId: new mongoose.Types.ObjectId(),
      url: 'https://inventory.test/malformed',
      contentHash: 'malformed',
      // A pre-versioning row whose derived facts never carried `schemaTypes`.
      facts: { wordCount: 120 },
    });

    await ContentInventoryPage.create({
      ...base,
      runId: new mongoose.Types.ObjectId(),
      url: 'https://inventory.test/mixed-types',
      contentHash: 'mixed-types',
      // Mixed is intentionally defensive: legacy/corrupt rows are filtered,
      // de-duplicated and response-bounded before reaching the picker.
      facts: {
        schemaTypes: [
          42,
          '',
          ' Article ',
          'z'.repeat(100),
          'Custom1',
          'Custom2',
          'Custom3',
          'Custom4',
          'Custom5',
          'Custom6',
          'Custom7',
          'Custom8',
        ],
        hasSchemaOrgArticle: false,
      },
    });

    // An untitled crawled page reports `null` rather than an invented title.
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      siteId: site._id,
      status: 'succeeded',
      pageCap: 25,
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://inventory.test/untitled',
      statusCode: 200,
      title: null,
      onPageScore: 40,
    });

    const sources = await listSources({ accountId, siteId: String(site._id) });
    expect(sources.auditedPages).toEqual([
      {
        url: 'https://inventory.test/untitled',
        title: null,
        hasStructuredData: false,
        structuredDataErrors: 0,
        richResultsVerdict: null,
      },
    ]);
    expect(sources.inventoryPages).toHaveLength(3);
    expect(sources.inventoryPages.map((page) => page.url)).toEqual(
      expect.arrayContaining([
        'https://inventory.test/malformed',
        'https://inventory.test/mixed-types',
        'https://inventory.test/page',
      ]),
    );
    expect(
      sources.inventoryPages.find((page) => page.url === 'https://inventory.test/malformed'),
    ).toMatchObject({
      schemaTypes: [],
      hasSchemaOrgArticle: false,
    });
    expect(
      sources.inventoryPages.find((page) => page.url === 'https://inventory.test/mixed-types')
        ?.schemaTypes,
    ).toEqual([
      'Article',
      'z'.repeat(64),
      'Custom1',
      'Custom2',
      'Custom3',
      'Custom4',
      'Custom5',
      'Custom6',
    ]);
  });
});

