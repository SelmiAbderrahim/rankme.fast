import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { keywords } from './keywords.js';
import { rankCheckJobItems, rankCheckJobs } from './rank-check-jobs.js';
import { rankCheckOutcomes } from './rank-check-outcomes.js';

describe('rank check foreign keys', () => {
  it('cascades item removal with its job and keyword, and outcomes with their keyword', () => {
    const itemReferences = getTableConfig(rankCheckJobItems).foreignKeys.map((key) => ({
      columns: key.reference().columns.map((column) => column.name),
      target: getTableConfig(key.reference().foreignTable).name,
      targetColumns: key.reference().foreignColumns.map((column) => column.name),
      onDelete: key.onDelete,
    }));
    expect(itemReferences).toEqual([
      { columns: ['job_id'], target: getTableConfig(rankCheckJobs).name, targetColumns: ['id'], onDelete: 'cascade' },
      { columns: ['keyword_id'], target: getTableConfig(keywords).name, targetColumns: ['id'], onDelete: 'cascade' },
    ]);
    const [outcomeReference] = getTableConfig(rankCheckOutcomes).foreignKeys;
    expect(outcomeReference?.reference().columns.map((column) => column.name)).toEqual(['keyword_id']);
    expect(getTableConfig(outcomeReference!.reference().foreignTable).name).toBe(getTableConfig(keywords).name);
    expect(outcomeReference?.reference().foreignColumns.map((column) => column.name)).toEqual(['id']);
    expect(outcomeReference?.onDelete).toBe('cascade');
  });
});
