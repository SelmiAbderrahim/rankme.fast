import type { RootState } from '@app/store';
import type { Branding } from '../types';
import { initialState } from './brandingSlice';

// The lazy-loaded 'branding' reducer is injected right before this page's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.branding`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists (an unguarded read here surfaces as
// the route-level "Page not found" error boundary).
const selectSlice = (state: RootState) => state.branding ?? initialState;

export const selectBranding = (state: RootState): Branding => selectSlice(state).branding;
export const selectBrandingLoading = (state: RootState): boolean =>
  selectSlice(state).loading;
export const selectBrandingLoaded = (state: RootState): boolean => selectSlice(state).loaded;
export const selectBrandingLoadError = (state: RootState): string =>
  selectSlice(state).loadError;
export const selectBrandingSaving = (state: RootState): boolean => selectSlice(state).saving;
export const selectBrandingSaveError = (state: RootState): string =>
  selectSlice(state).saveError;
export const selectBrandingSaved = (state: RootState): boolean => selectSlice(state).saved;
