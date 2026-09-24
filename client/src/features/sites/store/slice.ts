import { createSlice } from '@reduxjs/toolkit';
import type { SitesState } from '../types';
import { addSite, loadSites, pauseSite, removeSite, renameSite, resumeSite } from './thunks';

const initialState: SitesState = {
  items: [],
  nextCursor: null,
  currentCursor: null,
  cursorStack: [],
  loading: false,
  loaded: false,
  error: '',
  adding: false,
  addError: '',
  deletingId: null,
  deleteError: '',
  renamingId: null,
  renameError: '',
  pausingId: null,
  pauseError: '',
  message: '',
};

const sitesSlice = createSlice({
  name: 'sites',
  initialState,
  reducers: {
    clearSiteMessages: (state) => {
      state.error = '';
      state.addError = '';
      state.deleteError = '';
      state.renameError = '';
      state.pauseError = '';
      state.message = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSites.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(loadSites.fulfilled, (state, action) => {
        const direction = action.meta.arg.direction ?? 'initial';
        const cursor = action.meta.arg.cursor ?? null;
        if (direction === 'next') {
          state.cursorStack.push(state.currentCursor);
        } else if (direction === 'prev') {
          state.cursorStack.pop();
        } else {
          state.cursorStack = [];
        }
        state.currentCursor = cursor;
        state.items = action.payload.sites;
        state.nextCursor = action.payload.nextCursor;
        state.loading = false;
        state.loaded = true;
      })
      .addCase(loadSites.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? '';
      })
      .addCase(addSite.pending, (state) => {
        state.adding = true;
        state.addError = '';
        state.message = '';
      })
      .addCase(addSite.fulfilled, (state, action) => {
        state.adding = false;
        state.message = action.payload.message;
      })
      .addCase(addSite.rejected, (state, action) => {
        state.adding = false;
        state.addError = action.payload ?? '';
      })
      .addCase(removeSite.pending, (state, action) => {
        state.deletingId = action.meta.arg;
        state.deleteError = '';
        state.message = '';
      })
      .addCase(removeSite.fulfilled, (state, action) => {
        state.deletingId = null;
        state.message = action.payload.message;
      })
      .addCase(removeSite.rejected, (state, action) => {
        state.deletingId = null;
        state.deleteError = action.payload ?? '';
      })
      .addCase(renameSite.pending, (state, action) => {
        state.renamingId = action.meta.arg.id;
        state.renameError = '';
        state.message = '';
      })
      .addCase(renameSite.fulfilled, (state, action) => {
        state.renamingId = null;
        state.message = action.payload.message;
        const idx = state.items.findIndex((s) => s.id === action.payload.site.id);
        if (idx >= 0) {
          state.items[idx] = action.payload.site;
        }
      })
      .addCase(renameSite.rejected, (state, action) => {
        state.renamingId = null;
        state.renameError = action.payload ?? '';
      })
      .addCase(pauseSite.pending, (state, action) => {
        state.pausingId = action.meta.arg;
        state.pauseError = '';
        state.message = '';
      })
      .addCase(pauseSite.fulfilled, (state, action) => {
        state.pausingId = null;
        state.message = action.payload.message;
        const idx = state.items.findIndex((s) => s.id === action.payload.site.id);
        if (idx >= 0) {
          state.items[idx] = action.payload.site;
        }
      })
      .addCase(pauseSite.rejected, (state, action) => {
        state.pausingId = null;
        state.pauseError = action.payload ?? '';
      })
      .addCase(resumeSite.pending, (state, action) => {
        state.pausingId = action.meta.arg;
        state.pauseError = '';
        state.message = '';
      })
      .addCase(resumeSite.fulfilled, (state, action) => {
        state.pausingId = null;
        state.message = action.payload.message;
        const idx = state.items.findIndex((s) => s.id === action.payload.site.id);
        if (idx >= 0) {
          state.items[idx] = action.payload.site;
        }
      })
      .addCase(resumeSite.rejected, (state, action) => {
        state.pausingId = null;
        state.pauseError = action.payload ?? '';
      });
  },
});

export const { clearSiteMessages } = sitesSlice.actions;
export const sitesReducer = sitesSlice.reducer;
