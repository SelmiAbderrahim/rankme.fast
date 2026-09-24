import type { Workspace } from '@features/team';

export type { Workspace };

export interface WorkspaceState {
  workspaces: Workspace[];
  /**
   * The workspace the user is working inside, or null for their own.
   *
   * Null rather than "the own account id" so the header is omitted entirely on
   * the default path — an absent header and the caller's own id mean the same
   * thing to the server, and omitting it keeps ordinary single-account traffic
   * byte-identical to before this feature existed.
   */
  activeWorkspaceId: string | null;
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  loadError: string;
}
