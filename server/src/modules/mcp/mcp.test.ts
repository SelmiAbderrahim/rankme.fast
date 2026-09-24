import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ActionsModule from '../actions/index.js';

const mocks = vi.hoisted(() => ({
  siteFind: vi.fn(),
  siteFindOne: vi.fn(),
  tryRunWithSiteWorkLease: vi.fn(),
  auditRunFindOne: vi.fn(),
  getAuditReport: vi.fn(),
  getLatestSiteReport: vi.fn(),
  getAuditRun: vi.fn(),
  startAuditForSite: vi.fn(),
  toPublicAuditRun: vi.fn(),
  listActionsForSite: vi.fn(),
  mutateActionState: vi.fn(),
  listKeywords: vi.fn(),
  getKeywordHistoryBatch: vi.fn(),
  listAnalyses: vi.fn(),
  getAnalysis: vi.fn(),
  getApiKeysDb: vi.fn(() => ({ kind: 'db' })),
  getAuditsQueue: vi.fn(() => ({ kind: 'queue' })),
  getAccountMcpSpec: vi.fn(async (): Promise<unknown> => null),
  transportSend: vi.fn(async (_message: unknown, _options?: unknown) => undefined),
  serverInstances: [] as Array<{
    tools: Map<string, (input: unknown) => Promise<unknown>>;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  transportInstances: [] as Array<{
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../sites/index.js', () => ({
  Site: { find: mocks.siteFind, findOne: mocks.siteFindOne },
  tryRunWithSiteWorkLease: mocks.tryRunWithSiteWorkLease,
}));

vi.mock('../audits/index.js', () => ({
  AuditRun: { findOne: mocks.auditRunFindOne },
  getAuditReport: mocks.getAuditReport,
  getLatestSiteReport: mocks.getLatestSiteReport,
  getAuditRun: mocks.getAuditRun,
  startAuditForSite: mocks.startAuditForSite,
  toPublicAuditRun: mocks.toPublicAuditRun,
  getAuditsQueue: mocks.getAuditsQueue,
}));

// Partial mock: the schemas import the real ACTION_STATES / ACTION_SOURCE_TYPES
// / MAX_LIST_LIMIT constants, so stubbing the whole barrel would let the tool
// schemas drift from the enums they are supposed to mirror.
vi.mock('../actions/index.js', async () => {
  const actual = await vi.importActual<typeof ActionsModule>('../actions/index.js');
  return {
    ...actual,
    listActionsForSite: mocks.listActionsForSite,
    mutateActionState: mocks.mutateActionState,
  };
});

vi.mock('../ranks/index.js', () => ({
  listKeywords: mocks.listKeywords,
  getKeywordHistoryBatch: mocks.getKeywordHistoryBatch,
}));

vi.mock('../content-intelligence/index.js', () => ({
  listAnalyses: mocks.listAnalyses,
  getAnalysis: mocks.getAnalysis,
}));

vi.mock('../api-keys/index.js', () => ({ getApiKeysDb: mocks.getApiKeysDb }));

vi.mock('../mcp-permissions/index.js', () => ({
  getAccountMcpSpec: mocks.getAccountMcpSpec,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    readonly tools = new Map<string, (input: unknown) => Promise<unknown>>();
    readonly connect = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);

    constructor() {
      mocks.serverInstances.push(this);
    }

    registerTool(
      name: string,
      _definition: unknown,
      handler: (input: unknown) => Promise<unknown>,
    ): void {
      this.tools.set(name, handler);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    readonly handleRequest = vi.fn(async (_req: unknown, res: Response) => {
      res.status(200).json({ jsonrpc: '2.0', result: {} });
    });
    readonly close = vi.fn(async () => undefined);

    async send(message: unknown, options?: unknown): Promise<void> {
      await mocks.transportSend(message, options);
    }

    constructor() {
      mocks.transportInstances.push(this);
    }
  },
}));

import { env } from '../../config/env.js';
import { HttpError } from '../../shared/utils/http-error.js';
import {
  MCP_INPUT_SCHEMAS,
  mcpControllerTestables,
  mcpMethodNotAllowedHandler,
  mcpPostHandler,
} from './mcp.controller.js';
import { mcpRouter } from './mcp.routes.js';
import {
  MCP_PAGE_LIMIT_DEFAULT,
  MCP_PAGE_LIMIT_MAX,
  _uuidLoose,
  getRankHistoryInputSchema,
  listContentAnalysesInputSchema,
  listKeywordsInputSchema,
  startAuditInputSchema,
} from './mcp.schema.js';
import { getMcpAuditsQueue, getMcpDb } from './mcp.holder.js';
import {
  MCP_TOOL_NAMES,
  MCP_TOOL_REGISTRY,
  resolveMcpToolDefinition,
} from './mcp.registry.js';
import { resolveEffectivePermissions } from '../../shared/mcp-permissions/index.js';
import {
  resolveContextLocale,
  toolGetAuditStatus,
  toolGetContentAnalysis,
  toolGetLatestAuditReport,
  toolGetRankHistory,
  toolListActions,
  toolListContentAnalyses,
  toolListKeywords,
  toolListSites,
  toolSetActionState,
  toolStartAudit,
} from './mcp.tools.js';
import {
  DICTIONARIES,
  SUPPORTED_LOCALES,
  translate,
} from '../../shared/i18n/index.js';
import {
  isMcpJsonRpcMessage,
  jsonRpcRequestId,
  localizeMcpJsonRpcMessage,
  LocalizedMcpTransport,
  MCP_PROTOCOL_ERROR_CODES,
  respondMcpJsonRpcError,
} from './mcp.transport.js';

const SITE_ID = '507f1f77bcf86cd799439011';
const RUN_ID = '507f1f77bcf86cd799439012';
const ANALYSIS_ID = '507f1f77bcf86cd799439013';
const OTHER_SITE_ID = '507f1f77bcf86cd799439014';
/** Server-minted sha256 action id (64 hex). */
const ACTION_ID = 'a'.repeat(64);
const permissive = () =>
  resolveEffectivePermissions(null, null, MCP_TOOL_NAMES);
const context = {
  accountId: 'account-1',
  locale: 'en' as const,
  permissions: permissive(),
};

function queryResult<T>(value: T): { sort: ReturnType<typeof vi.fn>; lean: ReturnType<typeof vi.fn> } {
  return {
    sort: vi.fn(() => ({ lean: vi.fn(async () => value) })),
    lean: vi.fn(async () => value),
  };
}

function sortedResult<T>(value: T): { sort: ReturnType<typeof vi.fn> } {
  return { sort: vi.fn(async () => value) };
}

function responseDouble(): {
  response: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const setHeader = vi.fn();
  const response = { json, setHeader } as unknown as Response;
  const status = vi.fn(() => response);
  Object.assign(response, { status });
  return { response, status, json, setHeader };
}

async function invokeHandler(
  handler: typeof mcpPostHandler,
  request: Partial<Request>,
  response: Response,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => (error ? reject(error) : resolve(undefined));
    handler(request as Request, response, next);
    setImmediate(resolve);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverInstances.length = 0;
  mocks.transportInstances.length = 0;
  (env as { MCP_ENABLED: boolean }).MCP_ENABLED = true;
  mocks.getAccountMcpSpec.mockResolvedValue(null);
  mocks.tryRunWithSiteWorkLease.mockImplementation(
    async (_scope, _ownerPrefix, work: () => Promise<unknown>) => ({
      acquired: true,
      value: await work(),
    }),
  );
  mocks.listKeywords.mockResolvedValue({ keywords: [] });
  mocks.getKeywordHistoryBatch.mockResolvedValue([]);
  mocks.listAnalyses.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getAnalysis.mockResolvedValue({ analysisId: ANALYSIS_ID, status: 'completed' });
  mocks.startAuditForSite.mockResolvedValue({ id: RUN_ID, status: 'queued' });
  mocks.toPublicAuditRun.mockReturnValue({ id: RUN_ID, status: 'succeeded' });
  mocks.getAuditRun.mockResolvedValue({
    run: { id: RUN_ID, status: 'succeeded' },
    summary: { domainChecks: null, pagesCrawled: 0 },
  });
});

describe('MCP schemas and holders', () => {
  it('enforces bounded coercion, dates, cursors, ids, and strict objects', () => {
    expect(MCP_PAGE_LIMIT_DEFAULT).toBe(25);
    expect(MCP_PAGE_LIMIT_MAX).toBe(100);
    expect(listKeywordsInputSchema.parse({ siteId: SITE_ID, limit: '3' }).limit).toBe(3);
    expect(() => listKeywordsInputSchema.parse({ siteId: SITE_ID, limit: 101 })).toThrow();
    expect(() => listKeywordsInputSchema.parse({ siteId: SITE_ID, extra: true })).toThrow();
    expect(getRankHistoryInputSchema.parse({ siteId: SITE_ID, from: '2026-01-01' }).from).toBe(
      '2026-01-01',
    );
    expect(() => getRankHistoryInputSchema.parse({ siteId: SITE_ID, from: 'nope' })).toThrow();
    expect(listContentAnalysesInputSchema.parse({ siteId: SITE_ID, cursor: 'next' }).cursor).toBe(
      'next',
    );
    expect(() => listContentAnalysesInputSchema.parse({ siteId: SITE_ID, cursor: '' })).toThrow();
    expect(startAuditInputSchema.parse({ siteId: SITE_ID, pageCap: '10' }).pageCap).toBe(10);
    expect(() => startAuditInputSchema.parse({ siteId: SITE_ID, pageCap: 0 })).toThrow();
    expect(_uuidLoose.parse('12345678-1234-1234-1234-123456789abc')).toHaveLength(36);
    expect(Object.keys(MCP_INPUT_SCHEMAS)).toHaveLength(10);
    expect(mcpRouter.stack).toHaveLength(3);
  });

  it('returns the existing feature-owned DB and queue handles', () => {
    expect(getMcpDb()).toEqual({ kind: 'db' });
    expect(getMcpAuditsQueue()).toEqual({ kind: 'queue' });
  });
});

describe('MCP tool handlers', () => {
  it('lists sites with locale-aware empty and populated text', async () => {
    mocks.siteFind.mockReturnValueOnce(queryResult([]));
    await expect(toolListSites(undefined, context)).resolves.toMatchObject({
      structuredContent: { sites: [], locale: 'en' },
    });
    const PAUSED_SITE_ID = '507f1f77bcf86cd799439099';
    mocks.siteFind.mockReturnValueOnce(
      queryResult([
        {
          _id: SITE_ID,
          domain: 'example.com',
          url: 'https://example.com',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: PAUSED_SITE_ID,
          domain: 'paused.example',
          url: 'https://paused.example',
          paused: true,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]),
    );
    const result = await toolListSites({ locale: 'fr' }, context);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain(`- example.com (${SITE_ID})`);
    expect(text).not.toContain(`(${SITE_ID}) (${DICTIONARIES.fr.mcp.results.sitePaused})`);
    expect(text).toContain(
      `- paused.example (${PAUSED_SITE_ID}) (${DICTIONARIES.fr.mcp.results.sitePaused})`,
    );
    expect(result.structuredContent.locale).toBe('fr');
    expect(result.structuredContent.sites).toEqual([
      expect.objectContaining({ id: SITE_ID, paused: false }),
      expect.objectContaining({ id: PAUSED_SITE_ID, paused: true }),
    ]);
  });

  it('returns localized safe errors and the latest owned audit report', async () => {
    // Ownership / no-succeeded-run both surface from the shared audits helper.
    mocks.getLatestSiteReport.mockRejectedValueOnce(
      HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' }),
    );
    await expect(toolGetLatestAuditReport({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });

    mocks.getLatestSiteReport.mockRejectedValueOnce(
      HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' }),
    );
    await expect(toolGetLatestAuditReport({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'audits.errors.notFound' } },
    });

    mocks.getLatestSiteReport.mockResolvedValue({
      runId: RUN_ID,
      report: { counts: { passed: 4 } },
    });
    const report = await toolGetLatestAuditReport({ siteId: SITE_ID, locale: 'de' }, context);
    expect(mocks.getLatestSiteReport).toHaveBeenLastCalledWith({
      accountId: context.accountId,
      siteId: SITE_ID,
      locale: 'de',
    });
    expect(report.content[0]?.text).toBe(
      translate('de', 'mcp.results.latestAuditReport', {
        runId: RUN_ID,
        counts: JSON.stringify({ passed: 4 }, null, 2),
      }),
    );
    expect(report.structuredContent).toMatchObject({ runId: RUN_ID, locale: 'de' });
  });

  it('returns a real localized report — dictionary copy that quotes HTML is not forbidden output', async () => {
    // Regression guard for the denylist false positive that made this tool fail
    // for EVERY site: `auditRules.mobile-unfriendly.fix` legitimately contains
    // `<meta name="viewport" …>` and `<head>`, and every report carries that
    // rule because it emits a finding even with no PageSpeed data. Use the real
    // dictionary string so a future copy/scanner change re-trips this test.
    const realFix = DICTIONARIES.en.auditRules['mobile-unfriendly'].fix;
    expect(realFix).toContain('<meta ');
    mocks.getLatestSiteReport.mockResolvedValueOnce({
      runId: RUN_ID,
      report: {
        counts: { fixNow: 1, watch: 1, passed: 0 },
        findings: [
          {
            ruleId: 'mobile-unfriendly',
            bucket: 'watch',
            severity: 'warning',
            affectedUrls: ['https://example.com/'],
            copy: {
              titleKey: 'auditRules.mobile-unfriendly.title',
              whyKey: 'auditRules.mobile-unfriendly.why',
              fixKey: 'auditRules.mobile-unfriendly.fix',
              passedLabelKey: 'auditRules.mobile-unfriendly.passedLabel',
              title: DICTIONARIES.en.auditRules['mobile-unfriendly'].title,
              why: DICTIONARIES.en.auditRules['mobile-unfriendly'].why,
              fix: realFix,
              passedLabel:
                DICTIONARIES.en.auditRules['mobile-unfriendly'].passedLabel,
            },
          },
        ],
      },
    });
    const report = await toolGetLatestAuditReport({ siteId: SITE_ID }, context);
    expect(report.isError).toBeUndefined();
    expect(report.structuredContent).toMatchObject({ runId: RUN_ID });
  });

  it('still rejects authorization material hiding inside first-party copy fields', async () => {
    // The HTML allowance must not become a secret allowance.
    mocks.getLatestSiteReport.mockResolvedValueOnce({
      runId: RUN_ID,
      report: {
        counts: {},
        findings: [{ ruleId: 'x', copy: { fix: 'Bearer sk-live-not-allowed' } }],
      },
    });
    await expect(toolGetLatestAuditReport({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'mcp.errors.forbiddenOutput' } },
    });
  });

  it('lists keywords with default/explicit limits and empty/nonempty text', async () => {
    await expect(toolListKeywords({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      structuredContent: { keywords: [] },
    });
    expect(mocks.listKeywords).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: MCP_PAGE_LIMIT_DEFAULT }),
      expect.objectContaining({ ranksQueue: null }),
    );
    mocks.listKeywords.mockResolvedValueOnce({ keywords: [{ id: 'k1', phrase: 'rank me' }] });
    const result = await toolListKeywords({ siteId: SITE_ID, limit: 2 }, context);
    expect(result.content[0]?.text).toContain('rank me');
    expect(mocks.listKeywords).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 2 }),
      expect.any(Object),
    );
  });

  it('joins bounded rank histories and preserves optional dates', async () => {
    mocks.listKeywords.mockResolvedValueOnce({
      keywords: [
        { id: 'k1', phrase: 'one' },
        { id: 'k2', phrase: 'two' },
      ],
    });
    mocks.getKeywordHistoryBatch.mockResolvedValueOnce([{ keywordId: 'k1', series: [1] }]);
    const result = await toolGetRankHistory(
      { siteId: SITE_ID, from: '2026-01-01', to: '2026-01-31' },
      context,
    );
    expect(result.structuredContent).toEqual({
      keywords: [
        { id: 'k1', phrase: 'one', series: [1] },
        { id: 'k2', phrase: 'two', series: [] },
      ],
      locale: 'en',
    });
    expect(mocks.getKeywordHistoryBatch).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }),
      expect.any(Object),
    );
    mocks.listKeywords.mockResolvedValueOnce({ keywords: [] });
    await toolGetRankHistory({ siteId: SITE_ID }, context);
    expect(mocks.getKeywordHistoryBatch).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ from: expect.anything(), to: expect.anything() }),
      expect.any(Object),
    );
  });

  it('lists and gets content analyses with cursor branches', async () => {
    await expect(toolListContentAnalyses({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      content: [{ text: translate('en', 'mcp.results.contentAnalyses', { count: 0 }) }],
    });
    mocks.listAnalyses.mockResolvedValueOnce({ items: [{ id: 'a1' }], nextCursor: 'next' });
    const listed = await toolListContentAnalyses(
      { siteId: SITE_ID, limit: 2, cursor: 'cursor' },
      context,
    );
    expect(listed.content[0]?.text).toBe(
      translate('en', 'mcp.results.contentAnalysesMore', { count: 1 }),
    );
    expect(mocks.listAnalyses).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 2, cursor: 'cursor' }),
    );
    const detail = await toolGetContentAnalysis({ analysisId: ANALYSIS_ID }, context);
    expect(detail.content[0]?.text).toBe(
      translate('en', 'mcp.results.contentAnalysis', {
        analysisId: ANALYSIS_ID,
        status: 'completed',
      }),
    );
  });

  it('starts audits with and without page caps using canonical deps', async () => {
    await toolStartAudit({ siteId: SITE_ID }, context);
    expect(mocks.tryRunWithSiteWorkLease).toHaveBeenLastCalledWith(
      { accountId: context.accountId, siteId: SITE_ID },
      'mcp:start-audit',
      expect.any(Function),
    );
    expect(mocks.startAuditForSite).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ requestedPageCap: expect.anything() }),
      { auditsQueue: { kind: 'queue' } },
    );
    const started = await toolStartAudit({ siteId: SITE_ID, pageCap: 10 }, context);
    expect(started.content[0]?.text).toBe(
      translate('en', 'mcp.results.auditStarted', {
        runId: RUN_ID,
        status: 'queued',
      }),
    );
    expect(mocks.startAuditForSite).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestedPageCap: 10 }),
      expect.any(Object),
    );
  });

  it('does not start an audit when site deletion owns the lifecycle barrier', async () => {
    mocks.tryRunWithSiteWorkLease.mockResolvedValueOnce({ acquired: false });

    await expect(toolStartAudit({ siteId: SITE_ID }, context)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('lists next actions with filters, cursor, and an agent-usable text block', async () => {
    mocks.listActionsForSite.mockResolvedValue({
      items: [
        {
          id: ACTION_ID,
          state: 'open',
          version: 0,
          severity: 'critical',
          sourceType: 'audit_finding',
          problem: DICTIONARIES.ar.auditRules['mobile-unfriendly'].title,
          whyItMatters: DICTIONARIES.ar.auditRules['mobile-unfriendly'].why,
          // Real dictionary copy — `nextStep` maps to auditRules.<id>.fix, which
          // quotes HTML for some rules. Must not be treated as forbidden output.
          nextStep: DICTIONARIES.ar.auditRules['mobile-unfriendly'].fix,
          copy: {
            problem: { messageKey: 'auditRules.mobile-unfriendly.title' },
            whyItMatters: { messageKey: 'auditRules.mobile-unfriendly.why' },
            nextStep: { messageKey: 'auditRules.mobile-unfriendly.fix' },
          },
        },
      ],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: '20',
    });
    const listed = await toolListActions(
      {
        siteId: SITE_ID,
        state: ['open'],
        source: ['audit_finding'],
        severity: ['critical'],
        limit: 5,
        cursor: '20',
        locale: 'ar',
      },
      context,
    );
    expect(listed.isError).toBeUndefined();
    expect(listed.content[0]?.text).toContain(`${ACTION_ID} state=open version=0`);
    expect(listed.structuredContent).toMatchObject({
      nextCursor: '20',
      items: [{
        nextStep: DICTIONARIES.ar.auditRules['mobile-unfriendly'].fix,
        copy: { nextStep: { messageKey: 'auditRules.mobile-unfriendly.fix' } },
      }],
    });
    expect(mocks.listActionsForSite).toHaveBeenLastCalledWith({
      accountId: context.accountId,
      siteId: SITE_ID,
      locale: 'ar',
      db: { kind: 'db' },
      filters: { state: ['open'], source: ['audit_finding'], severity: ['critical'] },
      limit: 5,
      cursor: '20',
    });

    // No filters / no paging — the optional keys are omitted, not sent as undefined.
    mocks.listActionsForSite.mockResolvedValue({
      items: [],
      sourceStatus: {},
      nextCursor: null,
    });
    const bare = await toolListActions({ siteId: SITE_ID }, context);
    expect(bare.content[0]?.text).toContain(
      translate('en', 'mcp.results.actions', { count: 0 }),
    );
    expect(mocks.listActionsForSite).toHaveBeenLastCalledWith({
      accountId: context.accountId,
      siteId: SITE_ID,
      locale: context.locale,
      db: { kind: 'db' },
    });
  });

  it('moves an action state through the append-only service, defaulting the client key', async () => {
    mocks.mutateActionState.mockResolvedValue({
      actionId: ACTION_ID,
      state: 'dismissed',
      version: 1,
      replayed: false,
    });
    const result = await toolSetActionState(
      { siteId: SITE_ID, actionId: ACTION_ID, state: 'dismissed', expectedVersion: 0 },
      context,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      translate('en', 'mcp.results.actionState', {
        actionId: ACTION_ID,
        state: 'dismissed',
        version: 1,
        replayed: 'false',
      }),
    );
    expect(mocks.tryRunWithSiteWorkLease).toHaveBeenLastCalledWith(
      { accountId: context.accountId, siteId: SITE_ID },
      'mcp:set-action-state',
      expect.any(Function),
    );
    expect(mocks.mutateActionState).toHaveBeenLastCalledWith({
      accountId: context.accountId,
      siteId: SITE_ID,
      actionId: ACTION_ID,
      actorUserId: context.accountId,
      newState: 'dismissed',
      expectedVersion: 0,
      note: null,
      // A fixed default keeps the derived idempotency key stable, so an agent
      // retrying the same transition replays instead of racing a second write.
      clientKey: 'mcp',
      db: { kind: 'db' },
    });

    await toolSetActionState(
      {
        siteId: SITE_ID,
        actionId: ACTION_ID,
        state: 'completed',
        expectedVersion: 1,
        note: 'fixed in release 42',
        clientKey: 'agent-run-7',
      },
      context,
    );
    expect(mocks.mutateActionState).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'fixed in release 42', clientKey: 'agent-run-7' }),
    );
  });

  it('surfaces service conflicts and the deletion barrier on set_action_state', async () => {
    mocks.mutateActionState.mockRejectedValueOnce(
      HttpError.conflict({ code: 'ACTIONS_ERRORS_STALE_VERSION', messageKey: 'actions.errors.staleVersion' }),
    );
    await expect(
      toolSetActionState(
        { siteId: SITE_ID, actionId: ACTION_ID, state: 'dismissed', expectedVersion: 0 },
        context,
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'actions.errors.staleVersion' } },
    });

    mocks.tryRunWithSiteWorkLease.mockResolvedValueOnce({ acquired: false });
    await expect(
      toolSetActionState(
        { siteId: SITE_ID, actionId: ACTION_ID, state: 'dismissed', expectedVersion: 0 },
        context,
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
  });

  it('treats a blocked site exactly like a non-owned one on both action tools', async () => {
    const scoped = {
      ...context,
      permissions: resolveEffectivePermissions(
        { allowedSiteIds: [OTHER_SITE_ID] },
        null,
        MCP_TOOL_NAMES,
      ),
    };
    await expect(toolListActions({ siteId: SITE_ID }, scoped)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
    await expect(
      toolSetActionState(
        { siteId: SITE_ID, actionId: ACTION_ID, state: 'dismissed', expectedVersion: 0 },
        scoped,
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
    // The gate runs BEFORE any service call, so nothing leaks existence.
    expect(mocks.listActionsForSite).not.toHaveBeenCalled();
    expect(mocks.mutateActionState).not.toHaveBeenCalled();
  });

  it('returns safe audit-status errors and public success DTOs', async () => {
    mocks.getAuditRun.mockRejectedValueOnce(HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' }));
    await expect(toolGetAuditStatus({ runId: RUN_ID }, context)).resolves.toMatchObject({
      structuredContent: { error: { code: 'audits.errors.notFound' } },
    });
    const result = await toolGetAuditStatus({ runId: RUN_ID }, context);
    expect(result.structuredContent).toEqual({
      run: { id: RUN_ID, status: 'succeeded' },
      locale: 'en',
    });
    expect(mocks.getAuditRun).toHaveBeenLastCalledWith({
      runId: RUN_ID,
      accountId: context.accountId,
    });
  });

  it('maps validation, HttpError, and unexpected/denylist failures to safe tool errors', async () => {
    // Bad arguments are the caller's fault and say so — they used to be
    // indistinguishable from an internal fault.
    await expect(toolListSites({ unexpected: true }, context)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'mcp.errors.invalidInput' } },
    });
    mocks.getAnalysis.mockRejectedValueOnce(HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' }));
    await expect(toolGetContentAnalysis({ analysisId: ANALYSIS_ID }, context)).resolves.toMatchObject({
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
    mocks.getAnalysis.mockResolvedValueOnce({ analysisId: ANALYSIS_ID, status: 'completed', apiKey: 'x' });
    await expect(toolGetContentAnalysis({ analysisId: ANALYSIS_ID }, context)).resolves.toMatchObject({
      structuredContent: { error: { code: 'mcp.errors.forbiddenOutput' } },
    });
    // A genuinely unexpected throw still collapses to the generic bucket.
    mocks.getAnalysis.mockRejectedValueOnce(new Error('boom'));
    await expect(toolGetContentAnalysis({ analysisId: ANALYSIS_ID }, context)).resolves.toMatchObject({
      structuredContent: { error: { code: 'common.internalError' } },
    });
    mocks.getAnalysis.mockRejectedValueOnce('opaque failure');
    await expect(toolGetContentAnalysis({ analysisId: ANALYSIS_ID }, context)).resolves.toMatchObject({
      structuredContent: { error: { code: 'common.internalError' } },
    });

    for (const tool of [
      toolGetLatestAuditReport,
      toolListKeywords,
      toolGetRankHistory,
      toolListContentAnalyses,
      toolGetContentAnalysis,
      toolStartAudit,
      toolGetAuditStatus,
      toolListActions,
      toolSetActionState,
    ]) {
      await expect(tool(undefined, context)).resolves.toMatchObject({ isError: true });
    }
  });

  it('uses a valid argument locale for tool errors and the bearer locale for an invalid one', async () => {
    mocks.getAnalysis.mockRejectedValueOnce(
      HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' }),
    );
    const overridden = await toolGetContentAnalysis(
      { analysisId: ANALYSIS_ID, locale: 'ar' },
      { ...context, locale: 'fr' },
    );
    expect(overridden.structuredContent).toMatchObject({
      locale: 'ar',
      error: {
        code: 'sites.errors.notFound',
        message: translate('ar', 'sites.errors.notFound'),
      },
    });
    expect(overridden.content[0]?.text).toBe(translate('ar', 'sites.errors.notFound'));

    const invalid = await toolListSites(
      { locale: 'fr-CA' },
      { ...context, locale: 'de' },
    );
    expect(invalid.structuredContent).toMatchObject({
      locale: 'de',
      error: {
        code: 'mcp.errors.invalidInput',
        message: translate('de', 'mcp.errors.invalidInput'),
      },
    });
  });

  it('filters list_sites by the allowed-sites intersection', async () => {
    mocks.siteFind.mockReturnValueOnce(queryResult([]));
    const scoped = {
      ...context,
      permissions: resolveEffectivePermissions(
        { allowedSiteIds: [SITE_ID] },
        null,
        MCP_TOOL_NAMES,
      ),
    };
    await toolListSites(undefined, scoped);
    expect(mocks.siteFind).toHaveBeenLastCalledWith(
      {
        accountId: 'account-1',
        deletionStartedAt: null,
        _id: { $in: [SITE_ID] },
      },
      expect.any(Object),
    );
  });

  it('a permission-blocked site and a non-owned site are indistinguishable tool errors', async () => {
    const blocked = {
      ...context,
      permissions: resolveEffectivePermissions(
        { allowedSiteIds: ['507f1f77bcf86cd799439099'] },
        null,
        MCP_TOOL_NAMES,
      ),
    };
    for (const tool of [
      toolGetLatestAuditReport,
      toolListKeywords,
      toolGetRankHistory,
      toolListContentAnalyses,
      toolStartAudit,
    ]) {
      await expect(tool({ siteId: SITE_ID }, blocked)).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'sites.errors.notFound' } },
      });
    }
    // The ownership query never ran for the blocked site.
    expect(mocks.siteFindOne).not.toHaveBeenCalled();
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('start_audit surfaces the localized spend-blocked tool error without spending', async () => {
    const noSpend = {
      ...context,
      permissions: resolveEffectivePermissions({ allowSpend: false }, null, MCP_TOOL_NAMES),
    };
    await expect(toolStartAudit({ siteId: SITE_ID }, noSpend)).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'mcp.errors.spendNotAllowed' } },
    });
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('the registry names, spend flags, and executors match the eight tools', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(
      Object.keys(MCP_INPUT_SCHEMAS).sort(),
    );
    expect(MCP_TOOL_REGISTRY.start_audit.spend).toBe(true);
    for (const name of MCP_TOOL_NAMES) {
      if (name !== 'start_audit') expect(MCP_TOOL_REGISTRY[name].spend).toBe(false);
      expect(typeof MCP_TOOL_REGISTRY[name].execute).toBe('function');
      expect(MCP_TOOL_REGISTRY[name].description.length).toBeGreaterThan(0);
      expect(MCP_TOOL_REGISTRY[name].inputShape).toBeDefined();
    }
  });

  it.each(SUPPORTED_LOCALES)('resolves typed registry descriptions in %s', (locale) => {
    for (const name of MCP_TOOL_NAMES) {
      const definition = resolveMcpToolDefinition(name, locale);
      expect(definition.description).toBe(translate(locale, definition.descriptionKey));
      expect(definition.description).not.toContain(definition.descriptionKey);
      expect(definition.inputShape).toBe(MCP_TOOL_REGISTRY[name].inputShape);
      expect(definition.execute).toBe(MCP_TOOL_REGISTRY[name].execute);
      expect(definition.spend).toBe(MCP_TOOL_REGISTRY[name].spend);
    }
  });

  it('resolves argument/header locales with deterministic fallbacks', () => {
    expect(resolveContextLocale('fr', 'ar')).toBe('ar');
    expect(resolveContextLocale('fr', 'unknown')).toBe('fr');
    expect(resolveContextLocale('unknown', undefined)).toBe('en');
    expect(resolveContextLocale(undefined, 7)).toBe('en');
  });
});

describe('MCP HTTP controller', () => {
  it('returns localized unavailable and method-not-allowed envelopes', async () => {
    const disabled = responseDouble();
    (env as { MCP_ENABLED: boolean }).MCP_ENABLED = false;
    await invokeHandler(
      mcpPostHandler,
      { language: 'fr', body: {}, user: { id: 'account-1' } as Express.User },
      disabled.response,
    );
    expect(disabled.status).toHaveBeenCalledWith(503);
    expect(disabled.json).toHaveBeenCalledWith(expect.objectContaining({ jsonrpc: '2.0', id: null }));

    const notAllowed = responseDouble();
    mcpMethodNotAllowedHandler(
      { language: 'ar' } as Request,
      notAllowed.response,
      vi.fn(),
    );
    expect(notAllowed.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(notAllowed.status).toHaveBeenCalledWith(405);
    expect(notAllowed.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: DICTIONARIES.ar.mcp.protocol.invalidRequest },
    });
  });

  it('rejects JSON-RPC batches before constructing a transport', async () => {
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      { language: 'en', body: [], user: { id: 'account-1' } as Express.User },
      output.response,
    );
    expect(output.status).toHaveBeenCalledWith(400);
    expect(output.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: DICTIONARIES.en.mcp.protocol.invalidRequest },
    });
    expect(mocks.serverInstances).toHaveLength(0);
  });

  it('rejects malformed JSON-RPC and unknown tools with stable numeric errors', async () => {
    const malformed = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'de',
        body: { jsonrpc: '1.0', id: 'bad-1', method: 'tools/list' },
        user: { id: 'account-1' } as Express.User,
      },
      malformed.response,
    );
    expect(malformed.status).toHaveBeenCalledWith(400);
    expect(malformed.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 'bad-1',
      error: { code: -32700, message: DICTIONARIES.de.mcp.protocol.parseError },
    });

    const unknownTool = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'es',
        body: {
          jsonrpc: '2.0',
          id: 'tool-1',
          method: 'tools/call',
          params: { name: 'unknown_tool', arguments: {} },
        },
        user: { id: 'account-1' } as Express.User,
      },
      unknownTool.response,
    );
    expect(unknownTool.status).toHaveBeenCalledWith(200);
    expect(unknownTool.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 'tool-1',
      error: { code: -32602, message: DICTIONARIES.es.mcp.protocol.invalidParams },
    });
  });

  it('registers all tools, handles one request, and closes both resources', async () => {
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
      },
      output.response,
    );
    const server = mocks.serverInstances[0]!;
    const transport = mocks.transportInstances[0]!;
    expect([...server.tools]).toHaveLength(10);
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(transport.handleRequest).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
    const onerror = (transport as unknown as { onerror: (error: Error) => void }).onerror;
    expect(onerror).toBeTypeOf('function');
    onerror(new TypeError('bounded transport failure'));

    mocks.siteFind.mockReturnValue(queryResult([]));
    mocks.siteFindOne.mockResolvedValue({ _id: SITE_ID });
    mocks.auditRunFindOne.mockReturnValue(sortedResult({ _id: RUN_ID }));
    mocks.getAuditReport.mockResolvedValue({ counts: {} });
    mocks.auditRunFindOne.mockResolvedValue({ _id: RUN_ID });
    const inputs: Record<string, unknown> = {
      list_sites: {},
      get_latest_audit_report: { siteId: SITE_ID },
      list_keywords: { siteId: SITE_ID },
      get_rank_history: { siteId: SITE_ID },
      list_content_analyses: { siteId: SITE_ID },
      get_content_analysis: { analysisId: ANALYSIS_ID },
      start_audit: { siteId: SITE_ID },
      get_audit_status: { runId: RUN_ID },
    };
    for (const [name, handler] of server.tools) {
      await expect(handler(inputs[name])).resolves.toBeDefined();
    }
  });

  it('sets the HTTP response language from a valid tool override only', async () => {
    const overridden = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'fr',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_sites', arguments: { locale: 'ru' } },
        },
        user: { id: 'account-1' } as Express.User,
      },
      overridden.response,
    );
    expect(overridden.setHeader).toHaveBeenCalledWith('Content-Language', 'ru');

    const invalid = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'fr',
        body: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_sites', arguments: { locale: 'fr-CA' } },
        },
        user: { id: 'account-1' } as Express.User,
      },
      invalid.response,
    );
    expect(invalid.setHeader).toHaveBeenCalledWith('Content-Language', 'fr');
    expect(invalid.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32602, message: DICTIONARIES.fr.mcp.protocol.invalidParams },
    });
  });

  it('fails malformed tool-call structure closed before SDK execution', () => {
    const permissions = permissive();
    expect(mcpControllerTestables.toolLocaleArgument(null)).toBeUndefined();
    expect(mcpControllerTestables.toolLocaleArgument([])).toBeUndefined();
    expect(mcpControllerTestables.toolLocaleArgument({ method: 'ping' })).toBeUndefined();
    expect(mcpControllerTestables.toolLocaleArgument({
      method: 'tools/call',
      params: null,
    })).toBeUndefined();
    expect(mcpControllerTestables.toolLocaleArgument({
      method: 'tools/call',
      params: { name: 7, arguments: {} },
    })).toBeUndefined();
    expect(mcpControllerTestables.toolLocaleArgument({
      method: 'tools/call',
      params: { name: 'list_sites', arguments: [] },
    })).toBeUndefined();

    expect(mcpControllerTestables.validToolCall(null, permissions)).toBe(true);
    expect(mcpControllerTestables.validToolCall([], permissions)).toBe(true);
    expect(mcpControllerTestables.validToolCall({ method: 'ping' }, permissions)).toBe(true);
    expect(mcpControllerTestables.validToolCall({
      method: 'tools/call',
      params: null,
    }, permissions)).toBe(false);
    expect(mcpControllerTestables.validToolCall({
      method: 'tools/call',
      params: { name: 'unknown', arguments: {} },
    }, permissions)).toBe(false);
    expect(mcpControllerTestables.validToolCall({
      method: 'tools/call',
      params: { name: 'list_sites', arguments: [] },
    }, permissions)).toBe(false);
    expect(mcpControllerTestables.validToolCall({
      method: 'tools/call',
      params: { name: 'list_sites' },
    }, permissions)).toBe(true);
  });

  it('registers only allowed tools — account defaults hide a disabled tool', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({ tools: { start_audit: false } });
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
      },
      output.response,
    );
    const server = mocks.serverInstances[0]!;
    expect([...server.tools]).toHaveLength(9);
    expect(server.tools.has('start_audit')).toBe(false);
    expect(server.tools.has('list_sites')).toBe(true);
  });

  it('intersects key scopes — a scoped key restricts beyond the account defaults', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({ tools: { start_audit: false } });
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
        apiKeyScopes: { tools: { list_sites: false } },
      },
      output.response,
    );
    const server = mocks.serverInstances[0]!;
    expect(server.tools.has('start_audit')).toBe(false);
    expect(server.tools.has('list_sites')).toBe(false);
    expect(server.tools.has('get_rank_history')).toBe(true);
  });

  it('a key scope can never widen what the account disables', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({ tools: { start_audit: false } });
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
        apiKeyScopes: { tools: { start_audit: true } },
      },
      output.response,
    );
    expect(mocks.serverInstances[0]!.tools.has('start_audit')).toBe(false);
  });

  it('swallows transport/server close errors after a handled response', async () => {
    const output = responseDouble();
    const call = invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
      },
      output.response,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    mocks.transportInstances[0]!.close.mockRejectedValueOnce(new Error('transport close'));
    mocks.serverInstances[0]!.close.mockRejectedValueOnce(new Error('server close'));
    await expect(call).resolves.toBeUndefined();
  });

  it('returns a localized JSON-RPC internal error without raw diagnostics', async () => {
    mocks.getAccountMcpSpec.mockRejectedValueOnce(new Error('raw vendor diagnostic'));
    const output = responseDouble();
    await invokeHandler(
      mcpPostHandler,
      {
        language: 'zh',
        body: { jsonrpc: '2.0', id: 'internal-1', method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
      },
      output.response,
    );
    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 'internal-1',
      error: {
        code: -32603,
        message: DICTIONARIES.zh.mcp.protocol.internalError,
      },
    });
    expect(JSON.stringify(output.json.mock.calls)).not.toContain('raw vendor diagnostic');
  });

  it('classifies non-Error controller failures and leaves an already-sent response untouched', async () => {
    mocks.getAccountMcpSpec.mockRejectedValueOnce('opaque failure');
    const output = responseDouble();
    Object.assign(output.response, { headersSent: true });

    await invokeHandler(
      mcpPostHandler,
      {
        language: 'en',
        body: { jsonrpc: '2.0', id: 'sent-1', method: 'tools/list', params: {} },
        user: { id: 'account-1' } as Express.User,
      },
      output.response,
    );

    expect(output.status).not.toHaveBeenCalled();
    expect(output.json).not.toHaveBeenCalled();
  });
});

describe('localized MCP transport adapter', () => {
  const keys = [
    'parseError',
    'invalidRequest',
    'methodNotFound',
    'invalidParams',
    'internalError',
  ] as const;

  it.each(SUPPORTED_LOCALES)('maps stable numeric protocol errors in %s', (locale) => {
    MCP_PROTOCOL_ERROR_CODES.forEach((code, index) => {
      const localized = localizeMcpJsonRpcMessage(
        {
          jsonrpc: '2.0',
          id: index,
          error: {
            code,
            message: 'SDK English diagnostic',
            data: { path: ['params', 'locale'], message: 'raw zod details' },
          },
        },
        locale,
      );
      expect(localized).toEqual({
        jsonrpc: '2.0',
        id: index,
        error: {
          code,
          message: DICTIONARIES[locale].mcp.protocol[keys[index]!],
          data: { path: ['params', 'locale'] },
        },
      });
      expect(JSON.stringify(localized)).not.toMatch(/SDK English|raw zod/u);
    });
  });

  it('leaves non-core errors unchanged and rejects unsafe protocol data', () => {
    const custom = {
      jsonrpc: '2.0' as const,
      id: 1,
      error: { code: -32000, message: 'custom' },
    };
    expect(localizeMcpJsonRpcMessage(custom, 'fr')).toBe(custom);
    expect(
      localizeMcpJsonRpcMessage(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'raw', data: { path: ['safe', 'Bearer raw token'] } },
        },
        'fr',
      ),
    ).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: DICTIONARIES.fr.mcp.protocol.parseError },
    });
    for (const data of [
      null,
      [],
      { path: 'params' },
      { path: Array.from({ length: 17 }, () => 'segment') },
      { path: [1.5] },
      { path: ['unsafe segment'] },
    ]) {
      expect(localizeMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32602, message: 'raw', data },
      }, 'fr')).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32602, message: DICTIONARIES.fr.mcp.protocol.invalidParams },
      });
    }
  });

  it('validates JSON-RPC shapes and preserves only string or numeric request ids', () => {
    expect(isMcpJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true);
    expect(isMcpJsonRpcMessage({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBe(false);
    expect(jsonRpcRequestId({ id: 'request-1' })).toBe('request-1');
    expect(jsonRpcRequestId({ id: 3 })).toBe(3);
    expect(jsonRpcRequestId({ id: null })).toBeNull();
    expect(jsonRpcRequestId([])).toBeNull();
  });

  it('localizes transport sends and preserves bounded protocol error data', async () => {
    const transport = new LocalizedMcpTransport('fr', {
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'SDK English' },
    });
    expect(mocks.transportSend).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: DICTIONARIES.fr.mcp.protocol.invalidParams },
    }, undefined);

    const output = responseDouble();
    respondMcpJsonRpcError(
      output.response,
      'de',
      400,
      -32602,
      'request-1',
      { path: ['params', 'locale'] },
    );
    expect(output.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 'request-1',
      error: {
        code: -32602,
        message: DICTIONARIES.de.mcp.protocol.invalidParams,
        data: { path: ['params', 'locale'] },
      },
    });
  });
});
