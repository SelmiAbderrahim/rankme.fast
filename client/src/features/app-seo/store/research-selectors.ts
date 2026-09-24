import type { RootState } from '@app/store';
import { initialAppSeoResearchState } from './research-slice';

export const selectAppSeoResearch = (state: RootState) =>
  state.appSeoResearch ?? initialAppSeoResearchState;
