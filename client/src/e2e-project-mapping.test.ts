/**
 * Proof that every `client/e2e/*.spec.ts` file is enrolled in
 * exactly one Playwright project.
 *
 * Predecessor prompts landed specs (`competitors-gap-smoke.spec.ts`,
 * `security-smoke.spec.ts`) without wiring a project entry, so
 * `playwright test --list` silently omitted them and the CI E2E job reported
 * a false green. This test parses `client/playwright.config.ts` and asserts
 * the 1:1 mapping so a future regression fails at unit-test time, hours
 * before the composed-stack Playwright run would surface it.
 *
 * The test intentionally does NOT import Playwright — it inspects the config
 * source textually so it works even when @playwright/test's Node bindings
 * are not resolvable (jsdom vitest environment).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_CLIENT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT_CONFIG_PATH = path.join(REPO_CLIENT_ROOT, 'playwright.config.ts');
const E2E_DIR = path.join(REPO_CLIENT_ROOT, 'e2e');

interface ProjectEntry {
  name: string;
  testMatchSource: string;
  regex: RegExp;
}

function parseProjectEntries(configSource: string): ProjectEntry[] {
  // Each project entry inside `projects: [ ... ]` declares:
  //   name: 'foo',
  //   testMatch: /foo\.spec\.ts/,
  // Extract every (name, testMatch) pair via a compiled global regex; the
  // config is authored by hand and never machine-generated, so a textual
  // parse is stable enough for this proof.
  // Capture the regex literal after `testMatch:` allowing escaped forward
  // slashes (`\/`) inside the pattern body. Flags after the closing `/` are
  // ignored — the specs are matched case-sensitively.
  const pattern = /name:\s*'([^']+)',\s*(?:\/\/[^\n]*\n\s*)*testMatch:\s*(\/(?:\\.|[^\\/\n])+\/)/g;
  const entries: ProjectEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(configSource)) !== null) {
    const name = match[1];
    const testMatchSource = match[2];
    if (name === undefined || testMatchSource === undefined) continue;
    // Strip leading `/` and trailing `/` before wrapping into a real regex.
    const body = testMatchSource.slice(1, -1);
    entries.push({
      name,
      testMatchSource,
      regex: new RegExp(body),
    });
  }
  return entries;
}

function listSpecFiles(): string[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
}

describe('playwright project ↔ spec mapping', () => {
  const configSource = readFileSync(PLAYWRIGHT_CONFIG_PATH, 'utf8');
  const projects = parseProjectEntries(configSource);
  const specs = listSpecFiles();

  it('parses at least one project entry (regression guard against edit that breaks the parser)', () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  it('assigns every spec file to exactly one project', () => {
    const orphans: string[] = [];
    const duplicates: Array<{ spec: string; matched: string[] }> = [];
    for (const spec of specs) {
      const matched = projects.filter((entry) => entry.regex.test(spec)).map((entry) => entry.name);
      if (matched.length === 0) orphans.push(spec);
      if (matched.length > 1) duplicates.push({ spec, matched });
    }
    expect(orphans, `orphan specs with no owning project: ${orphans.join(', ')}`).toEqual([]);
    expect(
      duplicates,
      `specs matched by multiple projects: ${duplicates.map((d) => `${d.spec}→[${d.matched.join(',')}]`).join(', ')}`,
    ).toEqual([]);
  });

  it('gives every project entry at least one matching spec on disk', () => {
    const empty: string[] = [];
    for (const project of projects) {
      const anyMatch = specs.some((spec) => project.regex.test(spec));
      if (!anyMatch) empty.push(`${project.name} (${project.testMatchSource})`);
    }
    expect(
      empty,
      `project entries with no matching spec file — either delete the entry or ship the spec: ${empty.join(', ')}`,
    ).toEqual([]);
  });

  it('gives every project a unique name (proof against copy-paste duplicates)', () => {
    const names = projects.map((entry) => entry.name);
    const unique = new Set(names);
    expect(unique.size, `duplicate project names: ${names.join(', ')}`).toBe(names.length);
  });
});
