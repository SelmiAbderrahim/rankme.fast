import type { RootState } from '@app/store';

export const selectSites = (state: RootState) => state.sites.items;
export const selectSitesLoading = (state: RootState) => state.sites.loading;
export const selectSitesLoaded = (state: RootState) => state.sites.loaded;
export const selectSitesError = (state: RootState) => state.sites.error;
export const selectNextCursor = (state: RootState) => state.sites.nextCursor;
export const selectCursorStack = (state: RootState) => state.sites.cursorStack;
export const selectAddingSite = (state: RootState) => state.sites.adding;
export const selectAddSiteError = (state: RootState) => state.sites.addError;
export const selectDeletingSiteId = (state: RootState) => state.sites.deletingId;
export const selectDeleteSiteError = (state: RootState) => state.sites.deleteError;
export const selectRenamingSiteId = (state: RootState) => state.sites.renamingId;
export const selectRenameSiteError = (state: RootState) => state.sites.renameError;
export const selectPausingSiteId = (state: RootState) => state.sites.pausingId;
export const selectPauseSiteError = (state: RootState) => state.sites.pauseError;
export const selectSitesMessage = (state: RootState) => state.sites.message;
