import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('backlink_row_snapshots forward migration', () => {
  const drizzleUrl = new URL('../../../drizzle/', import.meta.url);
  const metadataUrl = new URL('meta/', drizzleUrl);

  it('registers 0065 after the pre-existing 0064 migration with a chained snapshot', () => {
    const journal = JSON.parse(
      readFileSync(new URL('_journal.json', metadataUrl), 'utf8'),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const previous = journal.entries.find((entry) => entry.idx === 64);
    const current = journal.entries.find((entry) => entry.idx === 65);
    expect(current).toEqual({
      idx: 65,
      version: '7',
      when: 1786400000026,
      tag: '0065_serious_queen_noir',
      breakpoints: true,
    });
    expect(current?.when).toBeGreaterThan(previous?.when ?? 0);

    const previousSnapshot = JSON.parse(
      readFileSync(new URL('0064_snapshot.json', metadataUrl), 'utf8'),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(new URL('0065_snapshot.json', metadataUrl), 'utf8'),
    ) as { prevId: string };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
  });

  it('creates the ordered producer table with pinned bounds and no backfill', () => {
    const sql = readFileSync(
      new URL('0065_serious_queen_noir.sql', drizzleUrl),
      'utf8',
    );
    for (const production of [
      'CREATE TABLE "backlink_row_snapshots"',
      '"url" text NOT NULL',
      '"domain" text NOT NULL',
      '"spam_score" integer NOT NULL',
      '"first_seen" timestamp with time zone',
      '"last_seen" timestamp with time zone',
      '"dofollow" boolean NOT NULL',
      '"is_broken" boolean NOT NULL',
      '"captured_at" timestamp with time zone NOT NULL',
      '"spam_score" between 0 and 100',
      '"rubric_band" in (\'clean\', \'watch\', \'toxic\')',
      '"rationale_status" in (\'not_requested\', \'annotated\', \'abstained\', \'failed\')',
      '"account_id","site_id","captured_at","id"',
    ]) {
      expect(sql).toContain(production);
    }
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE)\s+(?:INTO\s+)?"?backlink_/iu);
  });
});
