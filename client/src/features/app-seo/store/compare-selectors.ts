import type { RootState } from '@app/store';
import type { AppSeoCompareState } from '../compare-types';
import { initialAppSeoCompareState } from './compare-slice';

export const selectAppSeoCompare = (state: RootState): AppSeoCompareState =>
  (state.appSeoCompare as AppSeoCompareState | undefined) ?? initialAppSeoCompareState;
