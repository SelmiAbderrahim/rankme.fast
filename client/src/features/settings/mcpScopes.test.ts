import { describe, expect, it } from 'vitest';
import {
  createPermissiveMcpSettings,
  materializeMcpSpec,
  toMcpPermissionSpec,
} from './mcpScopes';
import { MCP_TOOL_NAMES } from './types';

describe('MCP scope form helpers', () => {
  it('creates fresh fully permissive settings', () => {
    const first = createPermissiveMcpSettings();
    const second = createPermissiveMcpSettings();
    expect(Object.keys(first.tools)).toEqual(MCP_TOOL_NAMES);
    expect(Object.values(first.tools).every(Boolean)).toBe(true);
    expect(first.allowedSiteIds).toEqual([]);
    expect(first.allowSpend).toBe(true);
    expect(first.tools).not.toBe(second.tools);
  });

  it('materializes sparse and missing key scopes without widening explicit false values', () => {
    expect(materializeMcpSpec(null)).toEqual(createPermissiveMcpSettings());
    const sites = ['site-1'];
    const materialized = materializeMcpSpec({
      tools: { start_audit: false },
      allowedSiteIds: sites,
      allowSpend: false,
    });
    expect(materialized.tools.start_audit).toBe(false);
    expect(materialized.tools.list_sites).toBe(true);
    expect(materialized.allowedSiteIds).toEqual(sites);
    expect(materialized.allowedSiteIds).not.toBe(sites);
    expect(materialized.allowSpend).toBe(false);
  });

  it('serializes and clones the complete draft', () => {
    const draft = createPermissiveMcpSettings();
    draft.tools.list_sites = false;
    draft.allowedSiteIds = ['site-1'];
    const spec = toMcpPermissionSpec(draft);
    expect(spec).toEqual(draft);
    expect(spec.tools).not.toBe(draft.tools);
    expect(spec.allowedSiteIds).not.toBe(draft.allowedSiteIds);
  });
});
