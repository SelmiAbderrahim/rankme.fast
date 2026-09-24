import { apiClient } from '@shared/api/client';
import type {
  ApiKeyCreateResponse,
  ApiKeyRevokeResponse,
  ApiKeyScopesResponse,
  ApiKeysListResponse,
  Branding,
  BrandingResponse,
  NotificationPreferences,
  NotificationPreferencesResponse,
  McpPermissionSettings,
  McpPermissionSpec,
} from './types';

export const getNotificationPreferencesRequest = (): Promise<NotificationPreferencesResponse> =>
  apiClient<NotificationPreferencesResponse>('/users/notifications');

export const patchNotificationPreferencesRequest = (
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferencesResponse> =>
  apiClient<NotificationPreferencesResponse>('/users/notifications', {
    method: 'PATCH',
    body: patch,
  });

export const listApiKeysRequest = (): Promise<ApiKeysListResponse> =>
  apiClient<ApiKeysListResponse>('/api-keys');

export const createApiKeyRequest = (input: {
  name: string;
  scopes?: McpPermissionSpec;
}): Promise<ApiKeyCreateResponse> =>
  apiClient<ApiKeyCreateResponse>('/api-keys', { method: 'POST', body: input });

export const revokeApiKeyRequest = (id: string): Promise<ApiKeyRevokeResponse> =>
  apiClient<ApiKeyRevokeResponse>(`/api-keys/${id}`, { method: 'DELETE' });

export const patchApiKeyScopesRequest = (
  id: string,
  scopes: McpPermissionSpec | null,
): Promise<ApiKeyScopesResponse> =>
  apiClient<ApiKeyScopesResponse>(`/api-keys/${id}/scopes`, {
    method: 'PATCH',
    body: { scopes },
  });

export const getMcpPermissionsRequest = (): Promise<McpPermissionSettings> =>
  apiClient<McpPermissionSettings>('/mcp-permissions');

export const putMcpPermissionsRequest = (
  settings: McpPermissionSettings,
): Promise<McpPermissionSettings> =>
  apiClient<McpPermissionSettings>('/mcp-permissions', {
    method: 'PUT',
    body: settings,
  });

export const getBrandingRequest = (): Promise<BrandingResponse> =>
  apiClient<BrandingResponse>('/users/branding');

export const putBrandingRequest = (branding: Branding): Promise<BrandingResponse> =>
  apiClient<BrandingResponse>('/users/branding', { method: 'PUT', body: branding });
