import type { RootState } from '@app/store';
import { initialSchemaGeneratorState, type SchemaGeneratorState } from '../types';

/**
 * The slice is lazily injected by the workspace panel, so every selector reads
 * through this fallback — a component rendered before injection (or in a test
 * with a bare store) sees the initial state instead of crashing (the shipped
 * `lazy-slice-eager-reader` hazard).
 */
export const selectSchemaGeneratorSlice = (state: RootState): SchemaGeneratorState =>
  (state as RootState & { schemaGenerator?: SchemaGeneratorState }).schemaGenerator ??
  initialSchemaGeneratorState;

const selectSlice = selectSchemaGeneratorSlice;

export const selectSchemaSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectSchemaTypes = (state: RootState) => selectSlice(state).types;
export const selectSchemaTypesStatus = (state: RootState) =>
  selectSlice(state).typesStatus;
export const selectSchemaRegistryVersion = (state: RootState) =>
  selectSlice(state).registryVersion;
export const selectSchemaSources = (state: RootState) => selectSlice(state).sources;
export const selectSchemaSourcesStatus = (state: RootState) =>
  selectSlice(state).sourcesStatus;
export const selectSchemaSourcesGate = (state: RootState) =>
  selectSlice(state).sourcesGate;
export const selectSchemaGenerations = (state: RootState) =>
  selectSlice(state).generations;
export const selectSchemaListStatus = (state: RootState) => selectSlice(state).listStatus;
export const selectSchemaListGate = (state: RootState) => selectSlice(state).listGate;
export const selectSchemaDetail = (state: RootState) => selectSlice(state).detail;
export const selectSchemaDetailStatus = (state: RootState) =>
  selectSlice(state).detailStatus;
export const selectSchemaDetailGate = (state: RootState) => selectSlice(state).detailGate;
export const selectSchemaPreview = (state: RootState) => selectSlice(state).preview;
export const selectSchemaPreviewStatus = (state: RootState) =>
  selectSlice(state).previewStatus;
export const selectSchemaPreviewGate = (state: RootState) =>
  selectSlice(state).previewGate;
export const selectSchemaGenerateStatus = (state: RootState) =>
  selectSlice(state).generateStatus;
export const selectSchemaGenerateGate = (state: RootState) =>
  selectSlice(state).generateGate;
export const selectSchemaForm = (state: RootState) => selectSlice(state).form;
