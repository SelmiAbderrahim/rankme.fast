import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  initialSchemaGeneratorState,
  type EvidenceSource,
  type SchemaGeneratorState,
  type SupportedSchemaType,
} from '../types';
import {
  createSchemaGenerationThunk,
  loadSchemaGeneration,
  loadSchemaGenerations,
  loadSchemaSources,
  loadSchemaTypes,
  previewSchemaGenerationThunk,
} from './thunks';

const slice = createSlice({
  name: 'schemaGenerator',
  initialState: initialSchemaGeneratorState,
  reducers: {
    /**
     * Switching sites drops every stored read so a picker never shows another
     * site's pages while the new site's lists are still loading.
     */
    setSchemaSiteId: (state, action: PayloadAction<string>) => {
      if (state.siteId === action.payload) return;
      return {
        ...initialSchemaGeneratorState,
        siteId: action.payload,
        // The registry projection is site-independent — keep it.
        registryVersion: state.registryVersion,
        types: state.types,
        typesStatus: state.typesStatus,
      } satisfies SchemaGeneratorState;
    },
    setSchemaSource: (state, action: PayloadAction<EvidenceSource>) => {
      state.form.source = action.payload;
      state.form.pageUrl = '';
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
    },
    setSchemaPageUrl: (state, action: PayloadAction<string>) => {
      state.form.pageUrl = action.payload;
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
    },
    setSchemaType: (state, action: PayloadAction<SupportedSchemaType>) => {
      state.form.schemaType = action.payload;
    },
    clearSchemaPreview: (state) => {
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSchemaTypes.pending, (state) => {
        state.typesStatus = 'loading';
      })
      .addCase(loadSchemaTypes.fulfilled, (state, action) => {
        state.typesStatus = 'ready';
        state.types = action.payload.types;
        state.registryVersion = action.payload.registryVersion;
      })
      .addCase(loadSchemaTypes.rejected, (state) => {
        state.typesStatus = 'error';
      })
      .addCase(loadSchemaSources.pending, (state) => {
        state.sourcesStatus = 'loading';
        state.sourcesGate = null;
      })
      .addCase(loadSchemaSources.fulfilled, (state, action) => {
        state.sourcesStatus = 'ready';
        state.sources = action.payload;
      })
      .addCase(loadSchemaSources.rejected, (state, action) => {
        state.sourcesStatus = 'error';
        state.sourcesGate = action.payload ?? null;
      })
      .addCase(loadSchemaGenerations.pending, (state) => {
        state.listStatus = 'loading';
        state.listGate = null;
      })
      .addCase(loadSchemaGenerations.fulfilled, (state, action) => {
        state.listStatus = 'ready';
        state.generations = action.payload;
      })
      .addCase(loadSchemaGenerations.rejected, (state, action) => {
        state.listStatus = 'error';
        state.listGate = action.payload ?? null;
      })
      .addCase(loadSchemaGeneration.pending, (state) => {
        state.detailStatus = 'loading';
        state.detailGate = null;
      })
      .addCase(loadSchemaGeneration.fulfilled, (state, action) => {
        state.detailStatus = 'ready';
        state.detail = action.payload;
      })
      .addCase(loadSchemaGeneration.rejected, (state, action) => {
        state.detailStatus = 'error';
        state.detailGate = action.payload ?? null;
      })
      .addCase(previewSchemaGenerationThunk.pending, (state) => {
        state.previewStatus = 'loading';
        state.previewGate = null;
      })
      .addCase(previewSchemaGenerationThunk.fulfilled, (state, action) => {
        state.previewStatus = 'ready';
        state.preview = action.payload;
      })
      .addCase(previewSchemaGenerationThunk.rejected, (state, action) => {
        state.previewStatus = 'error';
        state.previewGate = action.payload ?? null;
      })
      .addCase(createSchemaGenerationThunk.pending, (state) => {
        state.generateStatus = 'loading';
        state.generateGate = null;
      })
      .addCase(createSchemaGenerationThunk.fulfilled, (state, action) => {
        state.generateStatus = 'ready';
        state.detail = action.payload;
        state.detailStatus = 'ready';
        state.detailGate = null;
        // A fresh generation is the newest stored row — surface it in the
        // stored list without a second round trip.
        state.generations = [
          {
            id: action.payload.id,
            siteId: action.payload.siteId,
            pageUrl: action.payload.pageUrl,
            source: action.payload.source,
            schemaType: action.payload.schemaType,
            registryVersion: action.payload.registryVersion,
            status: action.payload.status,
            conformanceStatus: action.payload.conformanceStatus,
            failureReason: action.payload.failureReason,
            refunded: action.payload.refunded,
            generatedAt: action.payload.generatedAt,
          },
          ...state.generations.filter((row) => row.id !== action.payload.id),
        ];
        state.preview = null;
        state.previewStatus = 'idle';
      })
      .addCase(createSchemaGenerationThunk.rejected, (state, action) => {
        state.generateStatus = 'error';
        state.generateGate = action.payload ?? null;
      });
  },
});

export const schemaGeneratorReducer = slice.reducer;
export const {
  setSchemaSiteId,
  setSchemaSource,
  setSchemaPageUrl,
  setSchemaType,
  clearSchemaPreview,
} = slice.actions;
