import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the "broken snapshot chain" damage class: parallel
// executor sessions committing 000N.sql without a matching
// meta/000N_snapshot.json (or trimming the journal without cleaning the SQL).
// The next drizzle-kit generate re-emits already-applied DDL, which then
// fails on boot against an existing database. If a future PR drops a
// snapshot but leaves the journal entry, this file makes vitest red.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));
const META_DIR = path.join(MIGRATIONS_DIR, 'meta');
const JOURNAL_PATH = path.join(META_DIR, '_journal.json');

interface JournalEntry {
  idx: number;
  tag: string;
}
interface Journal {
  entries: JournalEntry[];
}

function readJournal(): Journal {
  return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) as Journal;
}

describe('drizzle migrations meta', () => {
  it('every journal entry has a matching meta snapshot file', () => {
    const journal = readJournal();
    const missing: string[] = [];
    for (const entry of journal.entries) {
      const padded = String(entry.idx).padStart(4, '0');
      const snapshot = path.join(META_DIR, `${padded}_snapshot.json`);
      if (!fs.existsSync(snapshot)) missing.push(`${padded}_snapshot.json (${entry.tag})`);
    }
    expect(missing, `missing snapshot files: ${missing.join(', ')}`).toEqual([]);
  });

  it('journal entries are contiguous from idx 0', () => {
    const journal = readJournal();
    const idxs = journal.entries.map((e) => e.idx).sort((a, b) => a - b);
    const expected = Array.from({ length: idxs.length }, (_, i) => i);
    expect(idxs).toEqual(expected);
  });

  it('every SQL migration file has a journal entry', () => {
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'));
    const journalTags = new Set(readJournal().entries.map((e) => e.tag));
    const orphans = sqlFiles.filter((name) => !journalTags.has(name.replace(/\.sql$/, '')));
    expect(orphans, `SQL files with no journal entry: ${orphans.join(', ')}`).toEqual([]);
  });
});
