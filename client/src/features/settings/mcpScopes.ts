import {
  MCP_TOOL_NAMES,
  type McpPermissionSettings,
  type McpPermissionSpec,
  type McpToolName,
} from './types';

/** Fresh permissive draft; never share the mutable tools object between forms. */
export function createPermissiveMcpSettings(): McpPermissionSettings {
  return {
    tools: Object.fromEntries(
      MCP_TOOL_NAMES.map((name) => [name, true]),
    ) as Record<McpToolName, boolean>,
    allowedSiteIds: [],
    allowSpend: true,
  };
}

/** Materialize optional key scopes into the same shape used by account defaults. */
export function materializeMcpSpec(
  spec: McpPermissionSpec | null | undefined,
): McpPermissionSettings {
  return {
    tools: Object.fromEntries(
      MCP_TOOL_NAMES.map((name) => [name, spec?.tools?.[name] ?? true]),
    ) as Record<McpToolName, boolean>,
    allowedSiteIds: [...(spec?.allowedSiteIds ?? [])],
    allowSpend: spec?.allowSpend ?? true,
  };
}

/** Serialize a complete form draft so server validation sees every toggle. */
export function toMcpPermissionSpec(
  settings: McpPermissionSettings,
): McpPermissionSpec {
  return {
    tools: { ...settings.tools },
    allowedSiteIds: [...settings.allowedSiteIds],
    allowSpend: settings.allowSpend,
  };
}
