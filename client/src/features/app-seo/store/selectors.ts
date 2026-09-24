import type { RootState } from '@app/store';
import { initialAppSeoState } from './slice';

const selectSlice = (state: RootState) => state.appSeo ?? initialAppSeoState;

export const selectAppProfiles = (state: RootState) => selectSlice(state).profiles;
export const selectAppSeoRegistration = (state: RootState) => selectSlice(state).registration;
export const selectAppProfileCount = (state: RootState) => selectSlice(state).profiles.length;
