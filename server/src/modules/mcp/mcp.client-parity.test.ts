/**
 * one tool registry, mirrored everywhere it is surfaced.
 *
 * The server registry (`MCP_TOOL_NAMES` + `MCP_TOOL_REGISTRY`) is the single
 * list. This pins every other place that must follow it: the client's
 * permission list and its seven-locale labels, the Assistant's JSON schemas,
 * the localized server descriptions, and the docs registry comment.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, SUPPORTED_LOCALES, translate } from '../../shared/i18n/index.js';
import { CHAT_TOOL_JSON_SCHEMAS } from '../chat/chat.tools.js';
import { MCP_TOOL_NAMES, MCP_TOOL_REGISTRY, resolveMcpToolDefinition } from './index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (relative: string) => readFileSync(resolve(REPO_ROOT, relative), 'utf8');

function clientToolNames(): string[] {
  const source = read('client/src/features/settings/types.ts');
  const block = /export const MCP_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!);
}

describe('MCP tool registry parity', () => {
  it('lists every tool once, in snake_case, with no duplicates', () => {
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
    for (const name of MCP_TOOL_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(Object.keys(MCP_TOOL_REGISTRY)).toEqual([...MCP_TOOL_NAMES]);
  });

  it('gives every tool a strict zod schema, a description, a permission key and an Assistant schema', () => {
    for (const name of MCP_TOOL_NAMES) {
      const definition = MCP_TOOL_REGISTRY[name];
      expect(definition.inputSchema.safeParse({ __unknown__: true }).success, name).toBe(false);
      expect(Object.keys(definition.inputShape), name).toContain('locale');
      expect(definition.description.length, name).toBeGreaterThan(8);
      expect(definition.execute, name).toBeTypeOf('function');
      expect(CHAT_TOOL_JSON_SCHEMAS[name], name).toBeDefined();
      // The permission key IS the tool name: the engine, the account settings
      // validator and the key scopes all index by it.
      expect(Object.keys(CHAT_TOOL_JSON_SCHEMAS)).toContain(name);
    }
    expect(Object.keys(CHAT_TOOL_JSON_SCHEMAS)).toEqual([...MCP_TOOL_NAMES]);
  });

  it('marks only start_audit as spending', () => {
    const spending = MCP_TOOL_NAMES.filter((name) => MCP_TOOL_REGISTRY[name].spend);
    expect(spending).toEqual(['start_audit']);
  });

  it('resolves a non-empty localized description for every tool in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const name of MCP_TOOL_NAMES) {
        const key = MCP_TOOL_REGISTRY[name].descriptionKey;
        const text = translate(locale, key);
        expect(text, `${locale}.${name}`).not.toBe(key);
        expect(resolveMcpToolDefinition(name, locale).description).toBe(text);
        expect(text.length, `${locale}.${name}`).toBeGreaterThan(8);
      }
    }
  });

  it('keeps the client permission list identical to the server registry', () => {
    expect(clientToolNames()).toEqual([...MCP_TOOL_NAMES]);
  });

  it.each(SUPPORTED_LOCALES)('labels and describes every tool in the client %s settings copy', (locale) => {
    const copy = JSON.parse(read(`client/src/shared/i18n/locales/${locale}/settings.json`)) as {
      mcp: { tools: Record<string, unknown> };
    };
    const tools = copy.mcp.tools;
    for (const name of MCP_TOOL_NAMES) {
      const entry = tools[name] as { name?: string; description?: string } | undefined;
      expect(entry?.name?.length, `${locale}.${name}.name`).toBeGreaterThan(1);
      expect(entry?.description?.length, `${locale}.${name}.description`).toBeGreaterThan(3);
    }
    const groups = tools.groups as Record<string, string>;
    expect(Object.keys(groups).length).toBeGreaterThanOrEqual(10);
    for (const label of Object.values(groups)) expect(label.length).toBeGreaterThan(1);
    expect(String(tools.readNote).length).toBeGreaterThan(20);
  });

  it('lists the registry in the docs comment of every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const doc = read(`docs/rankmefast-mcp.${locale}.md`);
      const comment = /<!-- mcp-tools: ([^>]*?) -->/.exec(doc)?.[1] ?? '';
      expect(comment.split(';').map((entry) => entry.trim()), locale).toEqual([...MCP_TOOL_NAMES]);
    }
  });

  it('keeps server dictionaries complete for the stored-read result copy', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const mcp = DICTIONARIES[locale].mcp;
      expect(mcp.results.stored.ok).toContain('{{tool}}');
      expect(mcp.results.stored.empty).toContain('{{reason}}');
      expect(mcp.errors.siteUnavailable.length).toBeGreaterThan(10);
      expect(mcp.scope.gscDimensionTotals.length).toBeGreaterThan(20);
    }
  });
});
