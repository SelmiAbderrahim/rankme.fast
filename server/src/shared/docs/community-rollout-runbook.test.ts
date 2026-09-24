/**
 * rankme-community-requests operator runbook — spec 13 §9.
 *
 * The runbook is operator material: English-only, under `ops/`, never served
 * from `/docs`. This suite pins it to shipped reality — every flag and
 * ceiling it names must exist in the env schema, every flag must appear in the rollback table, and the flip order must be the
 * ascending-blast-radius order the spec fixed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const RUNBOOK_DIR = join(
  REPO_ROOT,
  'ops',
  'runbooks',
  'rankme-community-requests-rollout',
);

const RUNBOOK_FILES = [
  'README.md',
  '01-zero-spend-flags.md',
  '02-stored-read-flags.md',
  '03-metered-ai-flags.md',
  '04-vendor-spend-flags.md',
  '05-rollback.md',
] as const;

/** The twelve batch flags, in their spec §9 (+ §15) step order. */
const STEP_FLAGS: Record<string, readonly string[]> = {
  '01-zero-spend-flags.md': [
    'SERP_FEATURE_TRACKING_ENABLED',
    'KEYWORD_CLUSTERING_ENABLED',
    'CANNIBALIZATION_ENABLED',
    'PUBLIC_EXPORTS_ENABLED',
  ],
  '02-stored-read-flags.md': [
    'INTERNAL_LINKING_ENABLED',
    'ALERTS_ENABLED',
    'CLIENT_REPORTS_ENABLED',
  ],
  '03-metered-ai-flags.md': [
    'SCHEMA_GENERATOR_ENABLED',
    'TOXIC_LINKS_ENABLED',
    'CONTENT_BRIEFS_ENABLED',
  ],
  '04-vendor-spend-flags.md': [
    'ALT_ENGINE_TRACKING_ENABLED',
    'GEOGRID_ENABLED',
  ],
};

const ALL_FLAGS = Object.values(STEP_FLAGS).flat();

const CEILINGS = [
  'CONTENT_BRIEF_COST_CEILING_MICROS',
  'INTERNAL_LINKING_COST_CEILING_MICROS',
  'TOXICITY_COST_CEILING_MICROS',
  'SCHEMA_GEN_COST_CEILING_MICROS',
] as const;

function read(file: string): string {
  return readFileSync(join(RUNBOOK_DIR, file), 'utf8');
}

function allSource(): string {
  return RUNBOOK_FILES.map(read).join('\n');
}

describe('rankme-community-requests operator runbook', () => {
  it('ships the five-file book plus index outside the served docs surface', () => {
    for (const file of RUNBOOK_FILES) {
      expect(existsSync(join(RUNBOOK_DIR, file)), file).toBe(true);
    }
    // Operator material must never leak into the localized /docs surface.
    for (const locale of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']) {
      expect(
        existsSync(
          join(REPO_ROOT, 'docs', `rankme-community-requests-rollout.${locale}.md`),
        ),
        locale,
      ).toBe(false);
    }
    expect(existsSync(join(REPO_ROOT, 'docs', 'runbooks'))).toBe(false);
  });

  it('names only flags that exist in the env schema', () => {
    const envSource = readFileSync(
      join(REPO_ROOT, 'server', 'src', 'config', 'env.ts'),
      'utf8',
    );
    const envKeys = new Set(
      [...envSource.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map(
        (match) => match[1] as string,
      ),
    );
    expect(envKeys.has('MCP_ENABLED'), 'env schema parse sanity').toBe(true);
    for (const flag of [...ALL_FLAGS, ...CEILINGS]) {
      expect(envKeys.has(flag), `env schema declares ${flag}`).toBe(true);
    }
  });

  it('assigns every flag to exactly one step, in ascending blast radius', () => {
    for (const [file, flags] of Object.entries(STEP_FLAGS)) {
      const source = read(file);
      for (const flag of flags) {
        expect(source, `${file} documents ${flag}`).toContain(flag);
      }
      // A flag documented in a step file belongs to no other step file.
      for (const [other, otherFlags] of Object.entries(STEP_FLAGS)) {
        if (other === file) continue;
        for (const flag of otherFlags) {
          expect(
            read(other).includes(flag) && source.includes(flag),
            `${flag} is owned by one step only (${file} vs ${other})`,
          ).toBe(false);
        }
      }
    }
  });

  it('lists the twelve flags in the README flip table in step order', () => {
    const readme = read('README.md');
    const positions = ALL_FLAGS.map((flag) => readme.indexOf(flag));
    for (const [index, position] of positions.entries()) {
      expect(position, `README names ${ALL_FLAGS[index]}`).toBeGreaterThan(-1);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions, 'README flip table is in step order').toEqual(sorted);
  });

  it('pins one canonical watch panel and regression metric per rollout step', () => {
    for (const file of Object.keys(STEP_FLAGS)) {
      const source = read(file);
      expect(source.match(/\*\*Superadmin panel\.\*\*/g), `${file} panel`).toHaveLength(1);
      expect(source.match(/\*\*Regression metric\.\*\*/g), `${file} metric`).toHaveLength(1);
      expect(source, `${file} preconditions`).toContain('**Preconditions.**');
    }

    const rollback = read('05-rollback.md');
    expect(rollback.match(/\*\*Superadmin panel\.\*\*/g), 'rollback panel').toHaveLength(1);
    expect(rollback.match(/\*\*Regression metric\.\*\*/g), 'rollback metric').toHaveLength(1);
    expect(rollback, 'rollback preconditions').toContain('**Preconditions.**');
  });

  it('states refuse / survive / finish for every flag in the rollback file', () => {
    const rollback = read('05-rollback.md');
    for (const flag of ALL_FLAGS) {
      expect(rollback, `rollback row for ${flag}`).toContain(flag);
    }
    expect(rollback).toContain('refuses');
    expect(rollback).toContain('leaves stored results readable');
    expect(rollback).toContain('finish');
  });

  it('mirrors every flag into api and worker, and forbids the _FILE secret path', () => {
    const readme = read('README.md');
    expect(readme).toContain('docker compose up -d --force-recreate api worker');
    expect(readme).toMatch(/both the `api` and the `worker`/);
    expect(readme).toMatch(/_FILE/);
  });

  it('is English-only operator prose with no localized sibling', () => {
    const source = allSource();
    // No Arabic, Cyrillic, or CJK characters anywhere in the book.
    expect(source).not.toMatch(/[؀-ۿЀ-ӿ一-鿿]/);
  });
});
