import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import { MCP_TOOL_NAMES, type McpToolName } from './types';
import {
  createApiKeyRequest,
  getBrandingRequest,
  getMcpPermissionsRequest,
  getNotificationPreferencesRequest,
  listApiKeysRequest,
  patchNotificationPreferencesRequest,
  patchApiKeyScopesRequest,
  putBrandingRequest,
  putMcpPermissionsRequest,
  revokeApiKeyRequest,
} from './api';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(message: string, status: number, data: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
}));

const apiClient = vi.mocked(client.apiClient);

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.mockResolvedValue({} as never);
});

describe('settings api wrappers', () => {
  it('getNotificationPreferencesRequest hits GET /users/notifications', async () => {
    await getNotificationPreferencesRequest();
    expect(apiClient).toHaveBeenCalledWith('/users/notifications');
  });

  it('patchNotificationPreferencesRequest sends the partial body', async () => {
    await patchNotificationPreferencesRequest({ emailMarketing: false });
    expect(apiClient).toHaveBeenCalledWith('/users/notifications', {
      method: 'PATCH',
      body: { emailMarketing: false },
    });
  });

  it('listApiKeysRequest hits GET /api-keys', async () => {
    await listApiKeysRequest();
    expect(apiClient).toHaveBeenCalledWith('/api-keys');
  });

  it('createApiKeyRequest POSTs the name', async () => {
    await createApiKeyRequest({ name: 'ci key', scopes: { allowSpend: false } });
    expect(apiClient).toHaveBeenCalledWith('/api-keys', {
      method: 'POST',
      body: { name: 'ci key', scopes: { allowSpend: false } },
    });
  });

  it('patchApiKeyScopesRequest replaces or clears key scopes', async () => {
    await patchApiKeyScopesRequest('k-9', { tools: { start_audit: false } });
    expect(apiClient).toHaveBeenCalledWith('/api-keys/k-9/scopes', {
      method: 'PATCH',
      body: { scopes: { tools: { start_audit: false } } },
    });
    await patchApiKeyScopesRequest('k-9', null);
    expect(apiClient).toHaveBeenLastCalledWith('/api-keys/k-9/scopes', {
      method: 'PATCH',
      body: { scopes: null },
    });
  });

  it('gets and replaces account MCP permissions', async () => {
    const settings = {
      tools: {
        ...(Object.fromEntries(MCP_TOOL_NAMES.map((name) => [name, true])) as Record<McpToolName, boolean>),
        start_audit: false,
      },
      allowedSiteIds: [],
      allowSpend: false,
    };
    await getMcpPermissionsRequest();
    expect(apiClient).toHaveBeenCalledWith('/mcp-permissions');
    await putMcpPermissionsRequest(settings);
    expect(apiClient).toHaveBeenLastCalledWith('/mcp-permissions', {
      method: 'PUT',
      body: settings,
    });
  });

  it('revokeApiKeyRequest DELETEs by id', async () => {
    await revokeApiKeyRequest('k-9');
    expect(apiClient).toHaveBeenCalledWith('/api-keys/k-9', { method: 'DELETE' });
  });

  it('getBrandingRequest hits GET /users/branding', async () => {
    await getBrandingRequest();
    expect(apiClient).toHaveBeenCalledWith('/users/branding');
  });

  it('putBrandingRequest PUTs the full branding object', async () => {
    await putBrandingRequest({ companyName: 'Acme', accentColor: '#b5321e', logoDataUrl: null });
    expect(apiClient).toHaveBeenCalledWith('/users/branding', {
      method: 'PUT',
      body: { companyName: 'Acme', accentColor: '#b5321e', logoDataUrl: null },
    });
  });
});
