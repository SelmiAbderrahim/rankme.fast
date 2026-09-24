import { createAsyncThunk } from '@reduxjs/toolkit';
import i18n from 'i18next';
import {
  createSchemaGeneration,
  fetchSchemaGeneration,
  fetchSchemaGenerations,
  fetchSchemaSources,
  fetchSchemaTypes,
  previewSchemaGeneration,
  type GenerationRequest,
} from '../api';
import { toSchemaGate } from '../gate';
import type {
  GenerationDetail,
  GenerationSummary,
  SchemaGate,
  SchemaSources,
  SchemaSpendPreview,
  SchemaTypesResponse,
} from '../types';

const fallback = () => i18n.t('schemaGenerator:states.failed.body');

export const loadSchemaTypes = createAsyncThunk<
  SchemaTypesResponse,
  void,
  { rejectValue: SchemaGate }
>('schemaGenerator/loadTypes', async (_arg, { rejectWithValue }) => {
  try {
    return await fetchSchemaTypes();
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});

export const loadSchemaSources = createAsyncThunk<
  SchemaSources,
  string,
  { rejectValue: SchemaGate }
>('schemaGenerator/loadSources', async (siteId, { rejectWithValue }) => {
  try {
    return await fetchSchemaSources(siteId);
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});

export const loadSchemaGenerations = createAsyncThunk<
  GenerationSummary[],
  string,
  { rejectValue: SchemaGate }
>('schemaGenerator/loadGenerations', async (siteId, { rejectWithValue }) => {
  try {
    const page = await fetchSchemaGenerations(siteId);
    return page.items;
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});

export const loadSchemaGeneration = createAsyncThunk<
  GenerationDetail,
  string,
  { rejectValue: SchemaGate }
>('schemaGenerator/loadGeneration', async (generationId, { rejectWithValue }) => {
  try {
    return await fetchSchemaGeneration(generationId);
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});

export const previewSchemaGenerationThunk = createAsyncThunk<
  SchemaSpendPreview,
  GenerationRequest,
  { rejectValue: SchemaGate }
>('schemaGenerator/preview', async (request, { rejectWithValue }) => {
  try {
    return await previewSchemaGeneration(request);
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});

export const createSchemaGenerationThunk = createAsyncThunk<
  GenerationDetail,
  GenerationRequest,
  { rejectValue: SchemaGate }
>('schemaGenerator/create', async (request, { rejectWithValue }) => {
  try {
    return await createSchemaGeneration(request);
  } catch (error) {
    return rejectWithValue(toSchemaGate(error, fallback()));
  }
});
