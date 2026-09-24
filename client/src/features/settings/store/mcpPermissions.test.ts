import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import * as api from '../api';
import { createPermissiveMcpSettings } from '../mcpScopes';
import {
  clearMcpPermissionsMessages,
  initialState,
  mcpPermissionsReducer,
} from './mcpPermissionsSlice';
import {
  loadMcpPermissions,
  saveMcpPermissions,
} from './mcpPermissionsThunks';

vi.mock('../api', () => ({
  getMcpPermissionsRequest: vi.fn(),
  putMcpPermissionsRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});
describe('MCP permissions state', () => {
  it('loads and saves settings through the API wrappers', async () => {
    const loaded = createPermissiveMcpSettings();
    loaded.tools.start_audit = false;
    const saved = { ...loaded, allowSpend: false };
    mocked.getMcpPermissionsRequest.mockResolvedValue(loaded);
    mocked.putMcpPermissionsRequest.mockResolvedValue(saved);
    const store = configureStore({ reducer: { mcpPermissions: mcpPermissionsReducer } });

    await store.dispatch(loadMcpPermissions());
    expect(store.getState().mcpPermissions.settings.tools.start_audit).toBe(false);
    await store.dispatch(saveMcpPermissions(saved));
    expect(mocked.putMcpPermissionsRequest).toHaveBeenCalledWith(saved);
    expect(store.getState().mcpPermissions.saved).toBe(true);
    expect(store.getState().mcpPermissions.settings.allowSpend).toBe(false);
  });

  it('uses server messages for load/save failures and clears them', async () => {
    mocked.getMcpPermissionsRequest.mockRejectedValue(
      new ApiError('load', 500, { error: { message: 'load denied' } }),
    );
    mocked.putMcpPermissionsRequest.mockRejectedValue(
      new ApiError('save', 500, { error: { message: 'save denied' } }),
    );
    const store = configureStore({ reducer: { mcpPermissions: mcpPermissionsReducer } });

    await store.dispatch(loadMcpPermissions());
    expect(store.getState().mcpPermissions).toMatchObject({
      loaded: true,
      loading: false,
      loadError: 'load denied',
    });
    await store.dispatch(saveMcpPermissions(createPermissiveMcpSettings()));
    expect(store.getState().mcpPermissions).toMatchObject({
      saving: false,
      saveError: 'save denied',
    });
    store.dispatch(clearMcpPermissionsMessages());
    expect(store.getState().mcpPermissions).toMatchObject({
      loadError: '',
      saveError: '',
      saved: false,
    });
  });

  it('falls back safely when rejected actions have no payload', () => {
    const loadRejected = loadMcpPermissions.rejected(new Error('x'), 'load');
    const saveRejected = saveMcpPermissions.rejected(
      new Error('x'),
      'save',
      createPermissiveMcpSettings(),
    );
    let state = mcpPermissionsReducer(initialState, loadRejected);
    expect(state.loadError).toBe('');
    state = mcpPermissionsReducer(state, saveRejected);
    expect(state.saveError).toBe('');
  });
});
