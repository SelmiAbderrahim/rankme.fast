import type { RootState } from '@app/store';
import { initialAppSeoReviewsState } from './reviews-slice';

export const selectAppSeoReviews = (state: RootState) =>
  state.appSeoReviews ?? initialAppSeoReviewsState;
