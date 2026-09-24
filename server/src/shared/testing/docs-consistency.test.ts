import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Fail the build if the guidance surfaces drift from the shipped tree.
//
// Three checks:
//   1. Every variable named in `CLAUDE.md` §4 exists in `.env.example`
//      (documented env is real).
//   2. Every module directory under `server/src/modules/` is listed in
//      `CLAUDE.md` §3 (repo layout mentions every module).
//   3. Every `.md` file under `.claude/rules/` is listed in
//      `.claude/rules/README.md` (index does not rot).

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function envKeysFromExample(source: string): Set<string> {
  const keys = new Set<string>();
  for (const line of source.split('\n')) {
    const trimmed = line.replace(/^#\s*/, '').trim();
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match && match[1]) keys.add(match[1]);
  }
  return keys;
}

function envKeysFromClaudeMd(source: string): Set<string> {
  // §4 embeds env vars as inline backticks: `NAME` and `NAME1` / `NAME2`.
  // Enumerate every backticked SCREAMING_SNAKE_CASE token that is a real
  // identifier (no trailing underscore — those are prefixes like `VITE_*`).
  const keys = new Set<string>();
  const re = /`([A-Z][A-Z0-9_]{2,}[A-Z0-9])`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match[1]) keys.add(match[1]);
  }
  return keys;
}

// Screaming-snake-case tokens that appear in CLAUDE.md but are NOT env vars —
// design-system tokens, constants, header names, etc. Anything here is
// explicitly declared safe to skip.
const ENV_ALLOWLIST_NON_ENV = new Set<string>([
  'CLAUDE',
  'CI',
  'HTTP',
  'JSON',
  'HTML',
  'URL',
  'REST',
  'API',
  'SDK',
  'SPA',
  'SSR',
  'RSC',
  'CSS',
  'DOM',
  'ORM',
  'DTO',
  'ISO',
  'YAML',
  'JWT',
  'JWTS',
  'OS',
  'MERN',
  'MB',
  'HMAC',
  'SHA',
  'MD',
  'GCM',
  'AES',
  'OAUTH',
  'OIDC',
  'CSRF',
  'IP',
  'ID',
  'IDS',
  'UI',
  'UX',
  'AI',
  'CRUX',
  'PSI',
  'GSC',
  'CRUD',
  'OWNER',
  'REPO',
  'TZ',
  'DNS',
  'TLS',
  'IPV4',
  'IPV6',
  'GDPR',
  'EMAIL_NOT_VERIFIED',
  'TASK_ID',
]);

describe('docs-consistency', () => {
  const envExample = read('.env.example');
  const claude = read('CLAUDE.md');

  it('every env var documented in CLAUDE.md §4 exists in .env.example', () => {
    const exampleKeys = envKeysFromExample(envExample);
    const claudeKeys = envKeysFromClaudeMd(claude);
    const missing: string[] = [];
    for (const key of claudeKeys) {
      if (ENV_ALLOWLIST_NON_ENV.has(key)) continue;
      // Ignore obvious constant names (all-caps single word without underscore
      // and 2 chars) — real env vars use SCREAMING_SNAKE_CASE with at least
      // one underscore OR a widely-recognized single-word env like PORT.
      const isSingleWord = !key.includes('_');
      const knownSingleWordEnv = new Set(['PORT', 'NODE_ENV']);
      if (isSingleWord && !knownSingleWordEnv.has(key)) continue;
      if (!exampleKeys.has(key)) missing.push(key);
    }
    expect(missing, `Documented in CLAUDE.md but missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('every module directory under server/src/modules is named in CLAUDE.md §3', () => {
    const modulesDir = path.join(REPO_ROOT, 'server/src/modules');
    const modules = fs
      .readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const missing = modules.filter((name) => !claude.includes(name));
    expect(missing, `Module directories missing from CLAUDE.md §3: ${missing.join(', ')}`).toEqual([]);
  });

  it('every rule file is listed in .claude/rules/README.md', () => {
    const rulesDir = path.join(REPO_ROOT, '.claude/rules');
    const rules = fs
      .readdirSync(rulesDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'README.md')
      .map((d) => d.name);
    const readme = fs.readFileSync(path.join(rulesDir, 'README.md'), 'utf8');
    const missing = rules.filter((file) => !readme.includes(file));
    expect(missing, `Rule files missing from .claude/rules/README.md: ${missing.join(', ')}`).toEqual([]);
  });

  // The audit feature flag was removed. It must not reappear
  // in any of the guidance surfaces or the sample env — those are the only
  // places a resurrected flag could land silently.
  it('VITE_AUDITS_ENABLED is fully purged from env + guidance surfaces', () => {
    const surfaces = [
      '.env.example',
      'CLAUDE.md',
      '.claude/rules/environment-variables.md',
      'docker-compose.yml',
      'client/Dockerfile',
    ];
    const offenders: string[] = [];
    for (const rel of surfaces) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      if (fs.readFileSync(abs, 'utf8').includes('VITE_AUDITS_ENABLED')) {
        offenders.push(rel);
      }
    }
    expect(offenders, `VITE_AUDITS_ENABLED still referenced in: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });
});
