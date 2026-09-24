import type { RootState } from '@app/store';
import { initialAppSeoChartsState } from './charts-slice';

export const selectAppSeoCharts = (state: RootState) =>
  state.appSeoCharts ?? initialAppSeoChartsState;
