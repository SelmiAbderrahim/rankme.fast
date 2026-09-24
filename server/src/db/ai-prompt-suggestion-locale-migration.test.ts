import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const OUTPUT_LOCALE_MIGRATION_INDEX = 115;

interface RawMigrationHarness {
  dialect: {
    migrate: (
      migrations: ReturnType<typeof readMigrationFiles>,
      session: unknown,
      config: { migrationsFolder: string },
    ) => Promise<void>;
  };
  session: unknown;
}

async function expectSqlRejection(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run;
    throw new Error('expected SQL statement to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? cause.message : '';
    expect(`${(error as Error).message}\n${causeMessage}`).toMatch(pattern);
  }
}

describe('0115 AI prompt suggestion output-locale migration', () => {
  it('backfills legacy rows, enforces seven locales, and installs the locale-aware index', async () => {
    const client = new PGlite();
    const database = drizzle(client);
    try {
      const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
      // Later, unrelated migrations may follow 0115. Pin this test to the
      // language migration's journal position without requiring it to remain
      // the final migration forever.
      expect(migrations.length).toBeGreaterThanOrEqual(OUTPUT_LOCALE_MIGRATION_INDEX + 1);
      const harness = database as unknown as RawMigrationHarness;
      await harness.dialect.migrate(
        migrations.slice(0, OUTPUT_LOCALE_MIGRATION_INDEX),
        harness.session,
        { migrationsFolder: MIGRATIONS_FOLDER },
      );

      await database.execute(sql.raw(`
        insert into ai_prompt_suggestion_runs
          (id, account_id, site_id, generated_at, prompts, seeds, generator, model)
        values
          ('00000000-0000-4000-8000-000000000001', 'legacy-account', 'legacy-site', now(), '[]', '{}', 'template', null)
      `));

      await harness.dialect.migrate(
        migrations.slice(0, OUTPUT_LOCALE_MIGRATION_INDEX + 1),
        harness.session,
        { migrationsFolder: MIGRATIONS_FOLDER },
      );

      const legacy = await database.execute(sql.raw(`
        select output_locale from ai_prompt_suggestion_runs where account_id = 'legacy-account'
      `));
      expect(legacy.rows).toEqual([{ output_locale: 'en' }]);

      await database.execute(sql.raw(`
        insert into ai_prompt_suggestion_runs
          (id, account_id, site_id, output_locale, prompts, seeds, generator)
        select
          ('10000000-0000-4000-8000-' || lpad(row_number() over ()::text, 12, '0'))::uuid,
          'seven-locales',
          'site-' || locale,
          locale,
          '[]',
          '{}',
          'template'
        from unnest(array['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']) locale
      `));
      const accepted = await database.execute(sql.raw(`
        select output_locale from ai_prompt_suggestion_runs
        where account_id = 'seven-locales'
        order by output_locale
      `));
      expect(accepted.rows.map((row) => row.output_locale)).toEqual([
        'ar',
        'de',
        'en',
        'es',
        'fr',
        'ru',
        'zh',
      ]);

      await expectSqlRejection(
        database.execute(sql.raw(`
          update ai_prompt_suggestion_runs set output_locale = 'pt'
          where account_id = 'legacy-account'
        `)),
        /ai_prompt_suggestion_runs_output_locale_check/,
      );

      const indexes = await database.execute(sql.raw(`
        select indexname from pg_indexes
        where tablename = 'ai_prompt_suggestion_runs'
        order by indexname
      `));
      expect(indexes.rows.map((row) => row.indexname)).toContain(
        'ai_prompt_suggestion_runs_account_site_locale_generated_idx',
      );
      expect(indexes.rows.map((row) => row.indexname)).not.toContain(
        'ai_prompt_suggestion_runs_account_site_generated_idx',
      );
    } finally {
      await client.close();
    }
  });
});
