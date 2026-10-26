import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  initialSchemaGeneratorState,
  type EvidenceSource,
  type GenerationDetail,
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
  regenerateSchemaGenerationThunk,
} from './thunks';

/** A fresh or rebuilt generation is the newest stored row of the list. */
function prependGeneration(state: SchemaGeneratorState, detail: GenerationDetail): void {
  state.generations = [
    {
      id: detail.id,
      siteId: detail.siteId,
      pageUrl: detail.pageUrl,
      source: detail.source,
      schemaType: detail.schemaType,
      registryVersion: detail.registryVersion,
      status: detail.status,
      conformanceStatus: detail.conformanceStatus,
      failureReason: detail.failureReason,
      generatedAt: detail.generatedAt,
      regeneratedFrom: detail.regeneratedFrom ?? null,
    },
    ...state.generations.filter((row) => row.id !== detail.id),
  ];
}

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
        prependGeneration(state, action.payload);
        state.preview = null;
        state.previewStatus = 'idle';
      })
      .addCase(createSchemaGenerationThunk.rejected, (state, action) => {
        state.generateStatus = 'error';
        state.generateGate = action.payload ?? null;
      })
      .addCase(regenerateSchemaGenerationThunk.pending, (state) => {
        state.regenerateStatus = 'loading';
        state.regenerateGate = null;
      })
      .addCase(regenerateSchemaGenerationThunk.fulfilled, (state, action) => {
        state.regenerateStatus = 'ready';
        // The detail pane is already open on the original. Swapping `detail`
        // before the URL names the rebuild would make the pane re-fetch the
        // original, so the URL change loads the rebuild instead.
        prependGeneration(state, action.payload);
      })
      .addCase(regenerateSchemaGenerationThunk.rejected, (state, action) => {
        state.regenerateStatus = 'error';
        state.regenerateGate = action.payload ?? null;
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
