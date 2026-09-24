import { describe, expect, it } from 'vitest';
import {
  CONTENT_INVENTORY_STAGE_ORDER,
  ContentInventoryTransitionError,
  assertContentInventoryTransition,
  canInventoryTransition,
  isContentInventoryCancellable,
  isInventoryTerminalStatus,
} from './inventory.state.js';
import {
  CONTENT_INVENTORY_STATUSES,
  CONTENT_INVENTORY_TERMINAL_STATUSES,
} from './inventory.model.js';

describe('content-inventory state machine', () => {
  it('classifies every status as a stage or a terminal', () => {
    const stageSet = new Set<string>(CONTENT_INVENTORY_STAGE_ORDER);
    const terminalSet = new Set<string>(CONTENT_INVENTORY_TERMINAL_STATUSES);
    for (const status of CONTENT_INVENTORY_STATUSES) {
      expect(stageSet.has(status) || terminalSet.has(status)).toBe(true);
    }
    for (const status of CONTENT_INVENTORY_TERMINAL_STATUSES) {
      expect(isInventoryTerminalStatus(status)).toBe(true);
      expect(isContentInventoryCancellable(status)).toBe(false);
    }
    for (const stage of CONTENT_INVENTORY_STAGE_ORDER) {
      expect(isInventoryTerminalStatus(stage)).toBe(false);
      expect(isContentInventoryCancellable(stage)).toBe(true);
    }
  });

  it('advances forward through consecutive stages', () => {
    for (let i = 0; i < CONTENT_INVENTORY_STAGE_ORDER.length - 1; i += 1) {
      expect(
        canInventoryTransition(
          CONTENT_INVENTORY_STAGE_ORDER[i]!,
          CONTENT_INVENTORY_STAGE_ORDER[i + 1]!,
        ),
      ).toBe(true);
    }
  });

  it('allows skipping stages forward', () => {
    expect(canInventoryTransition('queued', 'analyzing')).toBe(true);
  });

  it('rejects a backward transition', () => {
    expect(() => assertContentInventoryTransition('analyzing', 'crawling')).toThrow(
      ContentInventoryTransitionError,
    );
  });

  it('rejects re-entering the current stage', () => {
    expect(() => assertContentInventoryTransition('crawling', 'crawling')).toThrow(/cannot move/);
  });

  it('rejects any transition out of a terminal state', () => {
    for (const terminal of CONTENT_INVENTORY_TERMINAL_STATUSES) {
      for (const target of CONTENT_INVENTORY_STATUSES) {
        expect(() => assertContentInventoryTransition(terminal, target)).toThrow(/terminal state/);
      }
    }
  });

  it('allows any non-terminal stage to move to any terminal status', () => {
    for (const stage of CONTENT_INVENTORY_STAGE_ORDER) {
      for (const terminal of CONTENT_INVENTORY_TERMINAL_STATUSES) {
        expect(canInventoryTransition(stage, terminal)).toBe(true);
      }
    }
  });

  it('rejects an unknown source or target status', () => {
    expect(() =>
      assertContentInventoryTransition('nope' as never, 'crawling'),
    ).toThrow(/unknown source/);
    expect(() =>
      assertContentInventoryTransition('queued', 'nope' as never),
    ).toThrow(/unknown target/);
  });

  it('captures from/to on the thrown error', () => {
    let err: ContentInventoryTransitionError | null = null;
    try {
      assertContentInventoryTransition('analyzing', 'queued');
    } catch (e) {
      err = e as ContentInventoryTransitionError;
    }
    expect(err).not.toBeNull();
    expect(err!.from).toBe('analyzing');
    expect(err!.to).toBe('queued');
    expect(err!.name).toBe('ContentInventoryTransitionError');
  });

  it('canInventoryTransition returns false on rejection', () => {
    expect(canInventoryTransition('completed', 'queued')).toBe(false);
    expect(canInventoryTransition('queued', 'crawling')).toBe(true);
  });
});
