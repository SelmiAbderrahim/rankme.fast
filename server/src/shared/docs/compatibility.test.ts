import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_INPUT_SCHEMAS } from '../../modules/mcp/index.js';
import { v1Router } from '../../modules/public-api/index.js';
import { SUPPORTED_LOCALES } from '../i18n/index.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCS_DIR = join(REPO_ROOT, 'docs');

const PUBLIC_API_MARKER = /<!-- public-api-routes: ([^>]+) -->/gu;
const MCP_MARKER = /<!-- mcp-tools: ([^>]+) -->/gu;

interface ExpressRouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

function markerValues(source: string, pattern: RegExp): string[] {
  const matches = [...source.matchAll(pattern)];
  expect(matches).toHaveLength(1);
  return (matches[0]?.[1] ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
}

function publicApiRoutes(): string[] {
  const stack = (v1Router as unknown as { stack: ExpressRouteLayer[] }).stack;
  return stack.flatMap((layer) => {
    if (!layer.route) return [];
    return Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(
        ([method]) =>
          `${method.toUpperCase()} /api/v1${layer.route?.path ?? ''}`,
      );
  });
}

describe('public compatibility documentation', () => {
  it('pins every localized public API note to the actual v1 router', () => {
    const routes = publicApiRoutes();
    expect(routes).toEqual([
      'GET /api/v1/sites',
      'GET /api/v1/sites/:siteId/report/latest',
      'GET /api/v1/sites/:siteId/rank-history',
      'GET /api/v1/keywords',
      'GET /api/v1/serp-features',
      'GET /api/v1/backlink-rows',
    ]);

    for (const locale of SUPPORTED_LOCALES) {
      const source = readFileSync(
        join(DOCS_DIR, `public-api.${locale}.md`),
        'utf8',
      );
      expect(markerValues(source, PUBLIC_API_MARKER), locale).toEqual(routes);
    }
  });

  it('pins every localized MCP note to the actual tool registry', () => {
    const tools = Object.keys(MCP_INPUT_SCHEMAS);
    expect(tools).toEqual([
      'list_sites',
      'get_latest_audit_report',
      'list_keywords',
      'get_rank_history',
      'list_content_analyses',
      'get_content_analysis',
      'start_audit',
      'get_audit_status',
      'list_actions',
      'set_action_state',
    ]);

    for (const locale of SUPPORTED_LOCALES) {
      const source = readFileSync(
        join(DOCS_DIR, `rankmefast-mcp.${locale}.md`),
        'utf8',
      );
      expect(markerValues(source, MCP_MARKER), locale).toEqual(tools);
    }
  });

  it('does not invent API routes or MCP tools for the six new surfaces', () => {
    const shippedBoundary = [
      ...publicApiRoutes(),
      ...Object.keys(MCP_INPUT_SCHEMAS),
    ].join('\n');

    for (const absent of [
      'brand-radar',
      'review-intelligence',
      'link-intelligence',
      'traffic-insights',
      'keyword-trends',
      'serp-sensor',
      'volatility',
    ]) {
      expect(shippedBoundary).not.toContain(absent);
    }
  });
});
