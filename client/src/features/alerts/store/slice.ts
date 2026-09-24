import { createSlice } from '@reduxjs/toolkit';
import { initialAlertsState, type AlertGate, type AlertsState } from '../types';
import {
  createAlertRuleThunk,
  deleteAlertRuleThunk,
  loadAlertDeliveries,
  loadAlertRules,
  loadAlertSites,
  updateAlertRuleThunk,
} from './thunks';

/**
 * `rejectWithValue` always supplies a gate; the `?? null` keeps the reducer
 * total for the (unreachable in practice) thrown-error path.
 */
const gateOf = (payload: AlertGate | undefined): AlertGate | null => payload ?? null;

/**
 * Strip the show-once secret before the rule lands in the list. It lives only
 * in `revealedSecret` until the customer dismisses it — never in the rule row,
 * so a re-render or a refetch can never resurrect it.
 */
function withoutSecret(rule: AlertsState['rules'][number]) {
  const { webhookSecret: _ignored, ...rest } = rule;
  return rest;
}

const slice = createSlice({
  name: 'alerts',
  initialState: initialAlertsState,
  reducers: {
    dismissRevealedSecret: (state: AlertsState) => {
      state.revealedSecret = null;
    },
    clearAlertSaveGate: (state: AlertsState) => {
      state.saveStatus = 'idle';
      state.saveGate = null;
    },
    resetAlerts: () => initialAlertsState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAlertSites.pending, (state) => {
        state.sitesStatus = 'loading';
        state.sitesError = '';
      })
      .addCase(loadAlertSites.fulfilled, (state, action) => {
        state.sitesStatus = 'succeeded';
        state.sites = action.payload;
      })
      .addCase(loadAlertSites.rejected, (state, action) => {
        state.sitesStatus = 'failed';
        state.sitesError = action.payload ?? '';
      })
      .addCase(loadAlertRules.pending, (state) => {
        state.listStatus = 'loading';
        state.listGate = null;
      })
      .addCase(loadAlertRules.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.rules = action.payload.rules;
        state.capUsed = action.payload.cap.used;
      })
      .addCase(loadAlertRules.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.listGate = gateOf(action.payload);
      })
      .addCase(createAlertRuleThunk.pending, (state) => {
        state.saveStatus = 'loading';
        state.saveGate = null;
      })
      .addCase(createAlertRuleThunk.fulfilled, (state, action) => {
        state.saveStatus = 'succeeded';
        state.rules = [withoutSecret(action.payload), ...state.rules];
        state.capUsed += 1;
        state.revealedSecret = action.payload.webhookSecret
          ? { ruleId: action.payload.id, secret: action.payload.webhookSecret }
          : null;
      })
      .addCase(createAlertRuleThunk.rejected, (state, action) => {
        state.saveStatus = 'failed';
        state.saveGate = gateOf(action.payload);
      })
      .addCase(updateAlertRuleThunk.pending, (state) => {
        state.saveStatus = 'loading';
        state.saveGate = null;
      })
      .addCase(updateAlertRuleThunk.fulfilled, (state, action) => {
        state.saveStatus = 'succeeded';
        state.rules = state.rules.map((rule) =>
          rule.id === action.payload.id ? withoutSecret(action.payload) : rule,
        );
        state.revealedSecret = action.payload.webhookSecret
          ? { ruleId: action.payload.id, secret: action.payload.webhookSecret }
          : null;
      })
      .addCase(updateAlertRuleThunk.rejected, (state, action) => {
        state.saveStatus = 'failed';
        state.saveGate = gateOf(action.payload);
      })
      .addCase(deleteAlertRuleThunk.pending, (state) => {
        state.saveStatus = 'loading';
        state.saveGate = null;
      })
      .addCase(deleteAlertRuleThunk.fulfilled, (state, action) => {
        state.saveStatus = 'succeeded';
        state.rules = state.rules.filter((rule) => rule.id !== action.payload);
        state.capUsed = Math.max(0, state.capUsed - 1);
        if (state.revealedSecret?.ruleId === action.payload) {
          state.revealedSecret = null;
        }
      })
      .addCase(deleteAlertRuleThunk.rejected, (state, action) => {
        state.saveStatus = 'failed';
        state.saveGate = gateOf(action.payload);
      })
      .addCase(loadAlertDeliveries.pending, (state) => {
        state.logStatus = 'loading';
        state.logGate = null;
      })
      .addCase(loadAlertDeliveries.fulfilled, (state, action) => {
        state.logStatus = 'succeeded';
        state.deliveries = action.payload;
      })
      .addCase(loadAlertDeliveries.rejected, (state, action) => {
        state.logStatus = 'failed';
        state.deliveries = [];
        state.logGate = gateOf(action.payload);
      });
  },
});

export const { dismissRevealedSecret, clearAlertSaveGate, resetAlerts } = slice.actions;
export const alertsReducer = slice.reducer;
