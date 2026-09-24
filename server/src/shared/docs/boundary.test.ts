/**
 * Public vs operator boundary.
 *
 * Operator runbooks live at repo-root `ops/runbooks/**` and MUST stay out of
 * every public docs surface: the docs route, the search index, the sitemap
 * generator, and the web container image. The web container's only docs
 * input is the `./docs:/docs:ro` compose mount, and the docs runtime only
 * enumerates flat `<slug>.<locale>.md` files whose slug matches an anchored
 * allowlist pattern — this suite pins all of those properties.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCS_DIR = join(REPO_ROOT, 'docs');
const OPS_DIR = join(REPO_ROOT, 'ops');

const DOC_FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(en|ar|fr|de|es|ru|zh)\.md$/;

describe('docs/ops boundary', () => {
  it('operator runbooks exist under repo-root ops/, not under docs/', () => {
    const runbooks = readdirSync(
      join(OPS_DIR, 'runbooks', 'rankme-evidence-first-roadmap'),
    ).filter((name) => name.endsWith('.md'));
    expect(runbooks.length).toBeGreaterThan(0);
    const docsEntries = readdirSync(DOCS_DIR);
    expect(docsEntries).not.toContain('ops');
    expect(docsEntries).not.toContain('runbooks');
  });

  it('docs/ contains only flat public slug files — nothing else is servable', () => {
    for (const entry of readdirSync(DOCS_DIR)) {
      const stats = statSync(join(DOCS_DIR, entry));
      expect(stats.isFile(), `docs/${entry} must be a flat file`).toBe(true);
      expect(entry, `docs/${entry} must match <slug>.<locale>.md`).toMatch(
        DOC_FILE_RE,
      );
    }
  });

  it('the docs runtime rejects traversal-shaped slugs before touching the filesystem', async () => {
    const runtime = await import(
      /* @vite-ignore */ pathToFileURL(
        join(REPO_ROOT, 'client', 'docs-runtime.js'),
      ).href
    );
    const reader = runtime.createDocsReader(DOCS_DIR);
    for (const hostile of [
      '../ops/runbooks/rankme-evidence-first-roadmap/00-rollout-index',
      '..',
      'ops/runbooks',
      'OPS',
      'a_b',
      'a.b',
      '',
    ]) {
      expect(
        () => reader.readRaw('en', hostile),
        `slug ${JSON.stringify(hostile)} must be rejected`,
      ).toThrow();
    }
  });

  it('the docs search/index surface never lists an ops entry', async () => {
    const runtime = await import(
      /* @vite-ignore */ pathToFileURL(
        join(REPO_ROOT, 'client', 'docs-runtime.js'),
      ).href
    );
    const reader = runtime.createDocsReader(DOCS_DIR);
    const catalog = reader.readCatalog('en');
    const search = reader.readSearch('en');
    const slugs: string[] = [
      catalog.home.slug,
      ...catalog.docs.map((doc: { slug: string }) => doc.slug),
      ...search.docs.map((row: { slug: string }) => row.slug),
    ];
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(slug).not.toMatch(/ops|runbook/);
    }
  });

  it('gen-docs.mjs enumerates only the docs directory', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts', 'gen-docs.mjs'), 'utf8');
    expect(source).not.toMatch(/ops\//);
    expect(source).toContain("resolve(HERE, '..', 'docs')");
  });

  it('the web container never receives ops/** (compose mount + image copies)', () => {
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('./docs:/docs:ro');
    expect(compose).not.toMatch(/\.\/ops/);

    const clientDockerfile = readFileSync(
      join(REPO_ROOT, 'client', 'Dockerfile'),
      'utf8',
    );
    expect(clientDockerfile).not.toMatch(/ops/);

    const serverDockerfile = readFileSync(
      join(REPO_ROOT, 'server', 'Dockerfile'),
      'utf8',
    );
    expect(serverDockerfile).not.toMatch(/COPY[^\n]*ops/);
  });
});
