import type { RootState } from '@app/store';
import type { AppSeoListingState } from '../listing-types';
import { initialAppSeoListingState } from './listing-slice';

export const selectAppSeoListing = (state: RootState): AppSeoListingState =>
  (state.appSeoListing as AppSeoListingState | undefined) ?? initialAppSeoListingState;
