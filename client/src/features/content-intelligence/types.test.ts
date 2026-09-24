import { describe, expect, it } from 'vitest';
import {
  CONTENT_ANALYSIS_STATUSES,
  CONTENT_INVENTORY_STATUSES,
  CONTENT_SUB_VIEWS,
  DEFAULT_CONTENT_SUB_VIEW,
  INVENTORY_MAX_PAGES,
  INVENTORY_PAGES_PER_BLOCK,
  inventoryBlocksForPages,
  isContentAnalysisCancellable,
  isContentAnalysisStatus,
  isContentAnalysisTerminal,
  isContentInventoryCancellable,
  isContentInventoryStatus,
  isContentInventoryTerminal,
  isContentSubView,
} from './types';

describe('content-intelligence types', () => {
  it('CONTENT_ANALYSIS_STATUSES contains every lifecycle state', () => {
    expect(CONTENT_ANALYSIS_STATUSES).toContain('queued');
    expect(CONTENT_ANALYSIS_STATUSES).toContain('completed');
    expect(CONTENT_ANALYSIS_STATUSES).toContain('partial');
    expect(CONTENT_ANALYSIS_STATUSES).toContain('failed');
    expect(CONTENT_ANALYSIS_STATUSES).toContain('cancelled');
  });

  it('isContentAnalysisStatus guards unknown values', () => {
    expect(isContentAnalysisStatus('queued')).toBe(true);
    expect(isContentAnalysisStatus('nope')).toBe(false);
    expect(isContentAnalysisStatus(undefined)).toBe(false);
  });

  it('isContentAnalysisTerminal + Cancellable are complementary', () => {
    expect(isContentAnalysisTerminal('completed')).toBe(true);
    expect(isContentAnalysisTerminal('partial')).toBe(true);
    expect(isContentAnalysisTerminal('failed')).toBe(true);
    expect(isContentAnalysisTerminal('cancelled')).toBe(true);
    expect(isContentAnalysisTerminal('queued')).toBe(false);
    expect(isContentAnalysisCancellable('queued')).toBe(true);
    expect(isContentAnalysisCancellable('generating_draft')).toBe(true);
    expect(isContentAnalysisCancellable('completed')).toBe(false);
  });

  it('CONTENT_INVENTORY_STATUSES + guards cover every lifecycle state', () => {
    expect(CONTENT_INVENTORY_STATUSES).toContain('queued');
    expect(CONTENT_INVENTORY_STATUSES).toContain('crawling');
    expect(CONTENT_INVENTORY_STATUSES).toContain('analyzing');
    expect(isContentInventoryStatus('queued')).toBe(true);
    expect(isContentInventoryStatus('nope')).toBe(false);
    expect(isContentInventoryStatus(undefined)).toBe(false);
    expect(isContentInventoryTerminal('completed')).toBe(true);
    expect(isContentInventoryTerminal('partial')).toBe(true);
    expect(isContentInventoryTerminal('failed')).toBe(true);
    expect(isContentInventoryTerminal('cancelled')).toBe(true);
    expect(isContentInventoryTerminal('crawling')).toBe(false);
    expect(isContentInventoryCancellable('queued')).toBe(true);
    expect(isContentInventoryCancellable('completed')).toBe(false);
  });

  it('inventoryBlocksForPages mirrors ceil(pages / 4)', () => {
    expect(INVENTORY_PAGES_PER_BLOCK).toBe(4);
    expect(INVENTORY_MAX_PAGES).toBe(100);
    expect(inventoryBlocksForPages(0)).toBe(0);
    expect(inventoryBlocksForPages(-5)).toBe(0);
    expect(inventoryBlocksForPages(Number.NaN)).toBe(0);
    expect(inventoryBlocksForPages(1)).toBe(1);
    expect(inventoryBlocksForPages(4)).toBe(1);
    expect(inventoryBlocksForPages(5)).toBe(2);
    expect(inventoryBlocksForPages(100)).toBe(25);
  });

  it('CONTENT_SUB_VIEWS default is analyses', () => {
    expect(DEFAULT_CONTENT_SUB_VIEW).toBe('analyses');
    expect(CONTENT_SUB_VIEWS).toEqual([
      'analyses',
      'inventory',
      'competitors',
      'monitoring',
      'briefs',
    ]);
    expect(isContentSubView('analyses')).toBe(true);
    expect(isContentSubView('bogus')).toBe(false);
    expect(isContentSubView(42)).toBe(false);
  });
});
