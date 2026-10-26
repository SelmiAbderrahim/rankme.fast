// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec|d)\.tsx?$/.test(entry.name) && !relative(root, path).startsWith('test/') ? [path] : [];
  });
}
const files = sources(root).map((path) => ({ file: relative(root, path).replaceAll('\\', '/'), source: readFileSync(path, 'utf8') }));
const matching = (pattern: RegExp) => files.filter(({ source }) => pattern.test(source)).map(({ file }) => file).sort();

describe('shared runtime authorities', () => {
  it('creates relative-date formatters only in the canonical datetime utility', () => {
    expect(matching(/\bnew\s+Intl\.RelativeTimeFormat\b/)).toEqual(['shared/lib/datetime.ts']);
  });
  it('configures one toast renderer and mounts it once', () => {
    expect(matching(/import\s*\{[^}]*\bToaster\b[^}]*\}\s*from\s*['"]sonner['"]/)).toEqual(['shared/ui/sonner.tsx']);
    expect(matching(/<Toaster\b/)).toEqual(['app/providers.tsx']);
  });
  it('keeps Google readiness wording in its canonical notice when that surface is installed', () => {
    const notice = 'features/google/components/GoogleReadinessNotice.tsx';
    const installed = files.some(({ file }) => file === notice);
    expect(matching(/["'`]readiness\.(?:gsc|ga4|\$\{)/)).toEqual(installed ? [notice] : []);
  });
});
