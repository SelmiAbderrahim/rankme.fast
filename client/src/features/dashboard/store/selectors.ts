import type { RootState } from '@app/store';
import { dashboardInitialState } from './initialState';
import type { DashboardState } from '../types';

const selectSlice = (state: RootState): DashboardState => state.dashboard ?? dashboardInitialState;
export const selectSiteHealth = (state: RootState) => selectSlice(state).health;
export const selectSiteHealthLoading = (state: RootState) => selectSlice(state).loading;
export const selectSiteHealthLoadedAt = (state: RootState) => selectSlice(state).loadedAt;
export const selectSiteHealthError = (state: RootState) => selectSlice(state).error;
