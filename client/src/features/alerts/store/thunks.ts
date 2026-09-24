import { createAsyncThunk } from '@reduxjs/toolkit';
import i18n from 'i18next';
import {
  createAlertRule,
  deleteAlertRule,
  fetchAlertDeliveries,
  fetchAlertRules,
  fetchAlertSites,
  updateAlertRule,
  type CreateRuleInput,
  type FetchDeliveriesOptions,
  type FetchRulesOptions,
  type UpdateRuleInput,
} from '../api';
import { toAlertGate } from '../gate';
import type { AlertDelivery, AlertGate, AlertRule, AlertRulesPage, AlertSite } from '../types';

const fallback = () => i18n.t('alerts:states.failed.body');

export const loadAlertSites = createAsyncThunk<
  AlertSite[],
  void,
  { rejectValue: string }
>('alerts/loadSites', async (_arg, { rejectWithValue }) => {
  try {
    return await fetchAlertSites();
  } catch {
    return rejectWithValue(fallback());
  }
});

export const loadAlertRules = createAsyncThunk<
  AlertRulesPage,
  FetchRulesOptions | undefined,
  { rejectValue: AlertGate }
>('alerts/loadRules', async (args, { rejectWithValue }) => {
  try {
    return await fetchAlertRules(args ?? {});
  } catch (error) {
    return rejectWithValue(toAlertGate(error, fallback()));
  }
});

export const createAlertRuleThunk = createAsyncThunk<
  AlertRule,
  CreateRuleInput,
  { rejectValue: AlertGate }
>('alerts/createRule', async (input, { rejectWithValue }) => {
  try {
    return await createAlertRule(input);
  } catch (error) {
    return rejectWithValue(toAlertGate(error, fallback()));
  }
});

export interface UpdateRuleArgs {
  ruleId: string;
  patch: UpdateRuleInput;
}

export const updateAlertRuleThunk = createAsyncThunk<
  AlertRule,
  UpdateRuleArgs,
  { rejectValue: AlertGate }
>('alerts/updateRule', async (args, { rejectWithValue }) => {
  try {
    return await updateAlertRule(args.ruleId, args.patch);
  } catch (error) {
    return rejectWithValue(toAlertGate(error, fallback()));
  }
});

export const deleteAlertRuleThunk = createAsyncThunk<
  string,
  string,
  { rejectValue: AlertGate }
>('alerts/deleteRule', async (ruleId, { rejectWithValue }) => {
  try {
    await deleteAlertRule(ruleId);
    return ruleId;
  } catch (error) {
    return rejectWithValue(toAlertGate(error, fallback()));
  }
});

export interface LoadDeliveriesArgs extends FetchDeliveriesOptions {
  ruleId: string;
}

export const loadAlertDeliveries = createAsyncThunk<
  AlertDelivery[],
  LoadDeliveriesArgs,
  { rejectValue: AlertGate }
>('alerts/loadDeliveries', async (args, { rejectWithValue }) => {
  try {
    const { ruleId, ...options } = args;
    const page = await fetchAlertDeliveries(ruleId, options);
    return page.deliveries;
  } catch (error) {
    return rejectWithValue(toAlertGate(error, fallback()));
  }
});
