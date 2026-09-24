/**
 * Chat tool executor over the MCP registry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  siteFind: vi.fn(),
  siteFindOne: vi.fn(),
  tryRunWithSiteWorkLease: vi.fn(),
  auditRunFindOne: vi.fn(),
  getAuditReport: vi.fn(),
  getAuditRun: vi.fn(),
  startAuditForSite: vi.fn(),
  toPublicAuditRun: vi.fn(),
  listKeywords: vi.fn(),
  getKeywordHistoryBatch: vi.fn(),
  listAnalyses: vi.fn(),
  getAnalysis: vi.fn(),
  getApiKeysDb: vi.fn(() => ({ kind: 'db' })),
  getAuditsQueue: vi.fn(() => ({ kind: 'queue' })),
  getAccountMcpSpec: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('../sites/index.js', () => ({
  Site: { find: mocks.siteFind, findOne: mocks.siteFindOne },
  tryRunWithSiteWorkLease: mocks.tryRunWithSiteWorkLease,
}));
vi.mock('../audits/index.js', () => ({
  AuditRun: { findOne: mocks.auditRunFindOne },
  getAuditReport: mocks.getAuditReport,
  getAuditRun: mocks.getAuditRun,
  startAuditForSite: mocks.startAuditForSite,
  toPublicAuditRun: mocks.toPublicAuditRun,
  getAuditsQueue: mocks.getAuditsQueue,
}));
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

import { MCP_INPUT_SCHEMAS, MCP_TOOL_NAMES } from '../mcp/index.js';
import { CHAT_TOOL_JSON_SCHEMAS, buildChatTools } from './chat.tools.js';

const SITE_ID = '507f1f77bcf86cd799439011';
const OTHER_SITE_ID = '507f1f77bcf86cd799439099';

function queryResult<T>(value: T) {
  return {
    sort: vi.fn(() => ({ lean: vi.fn(async () => value) })),
    lean: vi.fn(async () => value),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccountMcpSpec.mockResolvedValue(null);
  mocks.tryRunWithSiteWorkLease.mockImplementation(
    async (_scope, _ownerPrefix, work: () => Promise<unknown>) => ({
      acquired: true,
      value: await work(),
    }),
  );
  mocks.siteFind.mockReturnValue(queryResult([]));
  mocks.listKeywords.mockResolvedValue({ keywords: [] });
  mocks.startAuditForSite.mockResolvedValue({ id: 'run-1', status: 'queued' });
  mocks.getAuditRun.mockResolvedValue({
    run: { id: 'run-1', status: 'queued' },
    summary: { domainChecks: null, pagesCrawled: 0 },
  });
});

describe('buildChatTools', () => {
  it('exposes every registry tool by default with descriptions and schemas', async () => {
    const { tools, permissions } = await buildChatTools('account-1', 'en');
    expect(Object.keys(tools).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(permissions.allowSpend).toBe(true);
    expect(tools.list_sites?.description).toContain('List sites');
    expect(tools.list_sites?.jsonSchema).toEqual(CHAT_TOOL_JSON_SCHEMAS.list_sites);
  });

  it('localizes descriptions while hiding and binding the accepted turn locale', async () => {
    const { tools } = await buildChatTools('account-1', 'fr');

    expect(tools.list_sites?.description).toContain('sites');
    for (const tool of Object.values(tools)) {
      const schema = tool.jsonSchema as { properties: Record<string, unknown> };
      expect(schema.properties).not.toHaveProperty('locale');
    }

    const outcome = await tools.list_sites!.execute({ locale: 'de' });
    expect(mocks.siteFind).toHaveBeenCalled();
    expect(outcome.structuredContent).toMatchObject({ locale: 'fr' });

    const invalid = await tools.list_sites!.execute('not-an-object');
    expect(invalid).toMatchObject({
      ok: false,
      structuredContent: { error: { code: 'mcp.errors.invalidInput' } },
    });
  });

  it('OMITS tools the account defaults disable — the model never sees them', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({
      tools: { start_audit: false, get_rank_history: false },
    });
    const { tools } = await buildChatTools('account-1', 'en');
    expect(tools.start_audit).toBeUndefined();
    expect(tools.get_rank_history).toBeUndefined();
    expect(tools.list_sites).toBeDefined();
  });

  it('filters the site intersection: blocked site ≡ non-owned site tool error', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({ allowedSiteIds: [OTHER_SITE_ID] });
    const { tools } = await buildChatTools('account-1', 'en');
    const outcome = await tools.get_latest_audit_report!.execute({ siteId: SITE_ID });
    expect(outcome.ok).toBe(false);
    expect(outcome.structuredContent).toMatchObject({
      error: { code: 'sites.errors.notFound' },
    });
    // The ownership query never ran for the blocked site.
    expect(mocks.siteFindOne).not.toHaveBeenCalled();

    // list_sites narrows its query to the allow-list.
    await tools.list_sites!.execute({});
    expect(mocks.siteFind).toHaveBeenLastCalledWith(
      {
        accountId: 'account-1',
        deletionStartedAt: null,
        _id: { $in: [OTHER_SITE_ID] },
      },
      expect.any(Object),
    );
  });

  it('intersects account defaults with the signed-in teammate site scope', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({
      allowedSiteIds: [SITE_ID, OTHER_SITE_ID],
    });
    const { tools, permissions } = await buildChatTools(
      'account-1',
      'en',
      [SITE_ID],
    );
    expect(permissions.allowedSiteIds).toEqual([SITE_ID]);
    await tools.list_sites!.execute({});
    expect(mocks.siteFind).toHaveBeenLastCalledWith(
      {
        accountId: 'account-1',
        deletionStartedAt: null,
        _id: { $in: [SITE_ID] },
      },
      expect.any(Object),
    );
    const denied = await tools.start_audit!.execute({ siteId: OTHER_SITE_ID });
    expect(denied.ok).toBe(false);
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('keeps an empty selected teammate scope as a lockout, not MCP all-sites', async () => {
    const { tools, permissions } = await buildChatTools('account-1', 'en', []);
    expect(permissions.allowedSiteIds).toEqual([]);
    const denied = await tools.get_latest_audit_report!.execute({ siteId: SITE_ID });
    expect(denied.ok).toBe(false);
    expect(mocks.siteFindOne).not.toHaveBeenCalled();
  });

  it('surfaces the localized spend-blocked error from start_audit without spending', async () => {
    mocks.getAccountMcpSpec.mockResolvedValue({ allowSpend: false });
    const { tools } = await buildChatTools('account-1', 'en');
    const outcome = await tools.start_audit!.execute({ siteId: SITE_ID });
    expect(outcome).toMatchObject({
      ok: false,
      structuredContent: { error: { code: 'mcp.errors.spendNotAllowed' } },
    });
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('start_audit spends through the canonical handler exactly once when allowed', async () => {
    const { tools } = await buildChatTools('account-1', 'en');
    const outcome = await tools.start_audit!.execute({ siteId: SITE_ID });
    expect(outcome.ok).toBe(true);
    expect(mocks.startAuditForSite).toHaveBeenCalledTimes(1);
  });

  it('start_audit cannot race a site deletion that owns the lifecycle barrier', async () => {
    mocks.tryRunWithSiteWorkLease.mockResolvedValueOnce({ acquired: false });
    const { tools } = await buildChatTools('account-1', 'en');

    const outcome = await tools.start_audit!.execute({ siteId: SITE_ID });

    expect(outcome).toMatchObject({
      ok: false,
      structuredContent: { error: { code: 'sites.errors.notFound' } },
    });
    expect(mocks.startAuditForSite).not.toHaveBeenCalled();
  });

  it('denylist-scans every result — a leaked secret key collapses to a safe error', async () => {
    mocks.getAnalysis.mockResolvedValueOnce({
      analysisId: SITE_ID,
      status: 'completed',
      apiKey: 'leaked',
    });
    const { tools } = await buildChatTools('account-1', 'en');
    const outcome = await tools.get_content_analysis!.execute({ analysisId: SITE_ID });
    expect(outcome).toMatchObject({
      ok: false,
      structuredContent: { error: { code: 'mcp.errors.forbiddenOutput' } },
    });
  });

  it('returns ok results with structured content for a healthy read', async () => {
    const { tools } = await buildChatTools('account-1', 'en');
    const outcome = await tools.list_keywords!.execute({ siteId: SITE_ID });
    expect(outcome.ok).toBe(true);
    expect(outcome.structuredContent).toEqual({ keywords: [], locale: 'en' });
  });
});

describe('CHAT_TOOL_JSON_SCHEMAS drift guard', () => {
  it('mirrors each zod shape except for the registry-only locale input', () => {
    for (const name of MCP_TOOL_NAMES) {
      const json = CHAT_TOOL_JSON_SCHEMAS[name] as {
        properties: Record<string, unknown>;
        required: readonly string[];
        additionalProperties: boolean;
      };
      const zodShape = MCP_INPUT_SCHEMAS[name as keyof typeof MCP_INPUT_SCHEMAS];
      const zodKeys = Object.keys(
        (zodShape as unknown as { shape: Record<string, unknown> }).shape,
      )
        .filter((key) => key !== 'locale')
        .sort();
      expect(Object.keys(json.properties).sort(), name).toEqual(zodKeys);
      expect(json.properties, name).not.toHaveProperty('locale');
      expect(json.additionalProperties, name).toBe(false);
      for (const requiredKey of json.required) {
        expect(zodKeys, `${name}.${requiredKey}`).toContain(requiredKey);
      }
    }
  });
});
