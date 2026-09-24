export { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
export { workspaceReducer, setActiveWorkspace, workspaceInitialState } from './store/slice';
export { loadWorkspaces } from './store/thunks';
export {
  selectActiveWorkspace,
  selectActiveWorkspaceId,
  selectActiveWorkspaceRole,
  selectHasMultipleWorkspaces,
  selectIsForeignWorkspace,
  selectWorkspaceLoadError,
  selectWorkspaceStatus,
  selectWorkspaces,
} from './store/selectors';
export { readStoredWorkspaceId, writeStoredWorkspaceId } from './storage';
export { canOpenRoute, ADMIN_ONLY_ROUTES, OWNER_ONLY_ROUTES } from './navPolicy';
export { WorkspaceRouteGuard } from './components/WorkspaceRouteGuard';
export type { Workspace, WorkspaceState } from './types';
