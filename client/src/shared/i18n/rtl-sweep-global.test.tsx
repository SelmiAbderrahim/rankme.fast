import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

// PRODUCT-WIDE RTL guard.
//
// Every .tsx under client/src (product code) must use LOGICAL directional
// utilities so Arabic (RTL) renders correctly. Tailwind's physical utilities —
// ml-N, mr-N, pl-N, pr-N, text-left, text-right — are LTR-only. Use their
// logical counterparts (ms-N, me-N, ps-N, pe-N, text-start, text-end) instead.
// Any variant prefix (sm:, md:, lg:, xl:, hover:, focus:, focus-visible:,
// active:, disabled:, group-hover:, group-focus:, dark:, group-<anything>: )
// counts.
//
// Scope: this guard globs the whole client/src tree so every current and future
// component is covered automatically. Do not add a per-file allowlist unless
// the file falls under the vendored-primitive exemption below.

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, '..', '..');

// Vendored shadcn primitives (client/src/shared/ui/*) ship with upstream
// physical utilities and MUST be kept in-sync with upstream — they are the
// only allowed exception. Each entry carries a written justification.
const ALLOWLIST: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: 'shared/ui/sidebar.tsx',
    reason:
      'Vendored shadcn sidebar primitive — text-left on the menu-button and pr-8 on the has-action variant come from upstream. Kept in sync with the shadcn registry; do not fork.',
  },
  {
    path: 'shared/ui/dialog.tsx',
    reason:
      'Vendored shadcn dialog primitive — `sm:text-left` on the header is the upstream centered→left transition. Kept in sync.',
  },
  {
    path: 'shared/ui/select.tsx',
    reason:
      'Vendored shadcn select primitive — pr-8/pl-2 on the item spacing come from upstream. Kept in sync.',
  },
  {
    path: 'shared/ui/dropdown-menu.tsx',
    reason:
      'Vendored shadcn dropdown-menu primitive — pr-2/pl-8 on the item spacing come from upstream. Kept in sync.',
  },
];

const ALLOWED_PATHS = new Set(ALLOWLIST.map((entry) => entry.path.replaceAll('/', sep)));

// The guard file itself references physical utilities in prose/comments/regex.
const SELF_PATH = ['shared', 'i18n', 'rtl-sweep-global.test.tsx'].join(sep);

// Physical directional Tailwind utilities. Matches any variant-prefix chain
// (sm:, md:, hover:, group-hover:, group-*:, dark:, focus-visible:, etc.) then
// text-left/text-right, ml-N/mr-N/pl-N/pr-N (incl. .5 and -px). Only inside
// class-string quotes/whitespace boundaries so it never matches identifier text.
const PHYSICAL_RE =
  /(?:^|[\s'"`])((?:[a-z][a-z0-9-]*:)*(?:text-(?:left|right)|[mp][lr]-(?:\d+(?:\.5)?|px)))(?=[\s'"`])/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
      walk(abs, out);
      continue;
    }
    if (stats.isFile() && (entry.endsWith('.tsx') || entry.endsWith('.ts'))) {
      out.push(abs);
    }
  }
  return out;
};

const ALL_FILES = walk(CLIENT_SRC)
  .map((abs) => relative(CLIENT_SRC, abs))
  .sort();

// Product files = everything except the vendored allowlist and this guard.
const PRODUCT_FILES = ALL_FILES.filter(
  (rel) => !ALLOWED_PATHS.has(rel) && rel !== SELF_PATH,
);

describe('client-wide logical-CSS RTL guard', () => {
  it('finds product source files to scan', () => {
    expect(PRODUCT_FILES.length).toBeGreaterThan(100);
  });

  it.each(PRODUCT_FILES)('%s uses only logical (RTL-safe) directional utilities', (rel) => {
    const contents = readFileSync(resolve(CLIENT_SRC, rel), 'utf8');
    const match = contents.match(PHYSICAL_RE);
    expect(
      match,
      `physical directional utility survived in ${rel}: ${match?.[0]}`,
    ).toBeNull();
  });

  it('every entry in the vendored-primitive allowlist carries a written justification', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length, `allowlist ${entry.path} needs a reason`).toBeGreaterThan(
        20,
      );
    }
  });

  it('every allowlisted path resolves to an existing vendored shadcn primitive', () => {
    for (const entry of ALLOWLIST) {
      const abs = resolve(CLIENT_SRC, entry.path);
      expect(() => readFileSync(abs, 'utf8'), `missing allowlisted file ${entry.path}`).not.toThrow();
      // Vendored exemption is scoped to client/src/shared/ui/*.
      expect(entry.path.startsWith('shared/ui/')).toBe(true);
    }
  });
});
