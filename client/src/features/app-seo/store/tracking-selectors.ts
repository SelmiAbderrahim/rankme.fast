import type { RootState } from '@app/store';
import { initialAppSeoTrackingState } from './tracking-slice';

export const selectAppSeoTracking = (state: RootState) =>
  state.appSeoTracking ?? initialAppSeoTrackingState;
