import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const RUNBOOK_DIR = join(
  REPO_ROOT,
  'ops',
  'runbooks',
  'semrush-parity-rollout',
);

const RUNBOOK_FILES = [
  'README.md',
  '02-cheap-metrics.md',
  '03-review-intelligence.md',
  '04-brand-radar.md',
] as const;

const FLAGS = [
  'LINK_INTELLIGENCE_ENABLED',
  'TRAFFIC_INSIGHTS_ENABLED',
  'KEYWORD_TRENDS_ENABLED',
  'REVIEW_INTELLIGENCE_ENABLED',
  'BRAND_RADAR_ENABLED',
] as const;

function allRunbookSource(): string {
  return RUNBOOK_FILES.map((file) =>
    readFileSync(join(RUNBOOK_DIR, file), 'utf8'),
  ).join('\n');
}

describe('SEMrush-parity operator runbook', () => {
  it('ships the decision-complete English-only runbook outside public docs', () => {
    for (const file of RUNBOOK_FILES) {
      expect(existsSync(join(RUNBOOK_DIR, file)), file).toBe(true);
    }
    expect(existsSync(join(REPO_ROOT, 'docs', 'runbooks'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'docs', 'semrush-parity-rollout.en.md'))).toBe(
      false,
    );
  });

  it('references only shipped flags and mirrors each one into api and worker', () => {
    const runbook = allRunbookSource();
    const envSchema = readFileSync(
      join(REPO_ROOT, 'server', 'src', 'config', 'env.ts'),
      'utf8',
    );
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');

    for (const flag of FLAGS) {
      expect(runbook, flag).toContain(flag);
      expect(envSchema, flag).toContain(flag);
      expect(example, flag).toContain(flag);
      expect(
        compose.match(new RegExp(`^\\s+${flag}:`, 'gm'))?.length,
        flag,
      ).toBe(2);
    }
  });

  it('documents ordered flips and paid stored-read rollback', () => {
    const index = readFileSync(join(RUNBOOK_DIR, 'README.md'), 'utf8');
    const prose = index.replace(/\s+/g, ' ');
    const positions = [
      'LINK_INTELLIGENCE_ENABLED=true',
      'TRAFFIC_INSIGHTS_ENABLED=true',
      'KEYWORD_TRENDS_ENABLED=true',
      'REVIEW_INTELLIGENCE_ENABLED=true',
      'BRAND_RADAR_ENABLED=true',
    ].map((needle) => index.indexOf(needle));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(prose).toContain('known stored paid-feature result must remain readable');
    expect(prose).toContain('never deletes stored rows');
    expect(index).not.toMatch(
      /\b(?:DELETE\s+FROM|UPDATE\s+[a-z_]+\s+SET|INSERT\s+INTO)\b/i,
    );
  });
});
