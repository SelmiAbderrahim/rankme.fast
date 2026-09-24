import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchWorkspacesRequest, type Workspace } from '@features/team';
import { ApiError } from '@shared/api/client';

/**
 * Load every workspace this human can open. Actor-scoped on the server, so it
 * is safe to call while already inside a foreign workspace.
 */
export const loadWorkspaces = createAsyncThunk<
  Workspace[],
  void,
  { rejectValue: string }
>('workspace/load', async (_arg, { rejectWithValue }) => {
  try {
    const { workspaces } = await fetchWorkspacesRequest();
    return workspaces;
  } catch (err) {
    const message =
      err instanceof ApiError && typeof err.data === 'object' && err.data !== null
        ? ((err.data as { error?: { message?: string } }).error?.message ?? '')
        : '';
    return rejectWithValue(message);
  }
});
