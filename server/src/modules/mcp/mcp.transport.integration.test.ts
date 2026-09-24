import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccountMcpSpec: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('../mcp-permissions/index.js', () => ({
  getAccountMcpSpec: mocks.getAccountMcpSpec,
}));

import { env } from '../../config/env.js';
import { DICTIONARIES, SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import { bearerLanguage } from '../../shared/middleware/bearer-language.js';
import { errorHandler } from '../../shared/middleware/error-handler.js';
import { Site } from '../sites/index.js';
import { mcpRouter } from './mcp.routes.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';

const authenticate: RequestHandler = (req, _res, next) => {
  req.user = { id: 'account-1' };
  req.apiKeyScopes = null;
  next();
};

const app = express();
app.use(express.json());
app.use('/api/mcp', bearerLanguage, authenticate, mcpRouter);
app.use(errorHandler);

function postRpc(body: object, languageHeader = 'en') {
  return request(app)
    .post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('x-lang', languageHeader)
    .send(body);
}

function expectNoInternalProse(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('{{');
  expect(serialized).not.toMatch(/mcp\.(?:tools|results|protocol|errors)\./u);
  expect(serialized).not.toMatch(
    /Input validation error|Invalid arguments for tool|Tool .* not found|Method not found|SDK English diagnostic|raw zod|raw vendor/iu,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getAccountMcpSpec.mockReset();
  mocks.getAccountMcpSpec.mockResolvedValue(null);
  (env as { MCP_ENABLED: boolean }).MCP_ENABLED = true;
  vi.spyOn(Site, 'find').mockReturnValue({
    sort: vi.fn(() => ({ lean: vi.fn(async () => []) })),
  } as never);
});

describe('real MCP SDK transport localization', () => {
  it.each(SUPPORTED_LOCALES)('lists localized stable tool descriptions in %s', async (locale) => {
    const response = await postRpc(
      { jsonrpc: '2.0', id: `list-${locale}`, method: 'tools/list', params: {} },
      locale,
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-language']).toBe(locale);
    expect(response.headers.vary).toBe('x-lang, Accept-Language');
    expect(response.body.jsonrpc).toBe('2.0');
    expect(response.body.id).toBe(`list-${locale}`);
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      MCP_TOOL_NAMES,
    );
    expect(response.body.result.tools.map((tool: { description: string }) => tool.description)).toEqual(
      MCP_TOOL_NAMES.map((name) => {
        const keyByName = {
          list_sites: 'listSites',
          get_latest_audit_report: 'getLatestAuditReport',
          list_keywords: 'listKeywords',
          get_rank_history: 'getRankHistory',
          list_content_analyses: 'listContentAnalyses',
          get_content_analysis: 'getContentAnalysis',
          start_audit: 'startAudit',
          get_audit_status: 'getAuditStatus',
          list_actions: 'listActions',
          set_action_state: 'setActionState',
        } as const;
        return DICTIONARIES[locale].mcp.tools[keyByName[name]].description;
      }),
    );
    expectNoInternalProse(response.body);
  });

  it.each(SUPPORTED_LOCALES)('returns a localized tool summary in %s', async (locale) => {
    const response = await postRpc(
      {
        jsonrpc: '2.0',
        id: `call-${locale}`,
        method: 'tools/call',
        params: { name: 'list_sites', arguments: {} },
      },
      locale,
    );

    expect(response.status).toBe(200);
    expect(response.body.result.content).toEqual([
      { type: 'text', text: DICTIONARIES[locale].mcp.results.sitesEmpty },
    ]);
    expect(response.body.result.structuredContent).toEqual({ sites: [], locale });
    expectNoInternalProse(response.body);
  });

  it('applies an exact tool override and rejects a regional argument in the bearer language', async () => {
    const overridden = await postRpc({
      jsonrpc: '2.0',
      id: 'override',
      method: 'tools/call',
      params: { name: 'list_sites', arguments: { locale: 'fr' } },
    });
    expect(overridden.headers['content-language']).toBe('fr');
    expect(overridden.body.result.content[0].text).toBe(DICTIONARIES.fr.mcp.results.sitesEmpty);
    expect(overridden.body.result.structuredContent.locale).toBe('fr');

    const invalid = await postRpc(
      {
        jsonrpc: '2.0',
        id: 'invalid-locale',
        method: 'tools/call',
        params: { name: 'list_sites', arguments: { locale: 'fr-CA' } },
      },
      'ar',
    );
    expect(invalid.status).toBe(200);
    expect(invalid.headers['content-language']).toBe('ar');
    expect(invalid.body).toEqual({
      jsonrpc: '2.0',
      id: 'invalid-locale',
      error: { code: -32602, message: DICTIONARIES.ar.mcp.protocol.invalidParams },
    });
    expectNoInternalProse(invalid.body);
  });

  it('localizes real-SDK unknown methods and controller malformed/unknown-tool errors', async () => {
    const unknownMethod = await postRpc(
      { jsonrpc: '2.0', id: 'method', method: 'rankme/unknown', params: {} },
      'de',
    );
    expect(unknownMethod.status).toBe(200);
    expect(unknownMethod.body).toEqual({
      jsonrpc: '2.0',
      id: 'method',
      error: { code: -32601, message: DICTIONARIES.de.mcp.protocol.methodNotFound },
    });

    const malformed = await postRpc(
      { jsonrpc: '1.0', id: 'malformed', method: 'tools/list' },
      'ru',
    );
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({
      jsonrpc: '2.0',
      id: 'malformed',
      error: { code: -32700, message: DICTIONARIES.ru.mcp.protocol.parseError },
    });

    const unknownTool = await postRpc(
      {
        jsonrpc: '2.0',
        id: 'tool',
        method: 'tools/call',
        params: { name: 'not_a_tool', arguments: {} },
      },
      'es',
    );
    expect(unknownTool.status).toBe(200);
    expect(unknownTool.body).toEqual({
      jsonrpc: '2.0',
      id: 'tool',
      error: { code: -32602, message: DICTIONARIES.es.mcp.protocol.invalidParams },
    });
    expectNoInternalProse([unknownMethod.body, malformed.body, unknownTool.body]);
  });

  it('keeps permission denial indistinguishable and localizes internal failures', async () => {
    mocks.getAccountMcpSpec.mockResolvedValueOnce({ tools: { list_sites: false } });
    const denied = await postRpc(
      {
        jsonrpc: '2.0',
        id: 'denied',
        method: 'tools/call',
        params: { name: 'list_sites', arguments: {} },
      },
      'zh',
    );
    expect(denied.body).toEqual({
      jsonrpc: '2.0',
      id: 'denied',
      error: { code: -32602, message: DICTIONARIES.zh.mcp.protocol.invalidParams },
    });

    mocks.getAccountMcpSpec.mockRejectedValueOnce(new Error('raw vendor failure'));
    const internal = await postRpc(
      { jsonrpc: '2.0', id: 'internal', method: 'tools/list', params: {} },
      'fr',
    );
    expect(internal.status).toBe(500);
    expect(internal.body).toEqual({
      jsonrpc: '2.0',
      id: 'internal',
      error: { code: -32603, message: DICTIONARIES.fr.mcp.protocol.internalError },
    });
    expectNoInternalProse([denied.body, internal.body]);
  });

  it('localizes the kill switch and method-not-allowed envelope', async () => {
    (env as { MCP_ENABLED: boolean }).MCP_ENABLED = false;
    const unavailable = await postRpc(
      { jsonrpc: '2.0', id: 'disabled', method: 'tools/list', params: {} },
      'ar',
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: DICTIONARIES.ar.mcp.errors.unavailable },
    });

    (env as { MCP_ENABLED: boolean }).MCP_ENABLED = true;
    const method = await request(app).get('/api/mcp').set('x-lang', 'fr-CA');
    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe('POST');
    expect(method.headers['content-language']).toBe('fr');
    expect(method.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: DICTIONARIES.fr.mcp.protocol.invalidRequest },
    });
  });
});
