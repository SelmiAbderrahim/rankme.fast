/**
 * Architectural boundary assertion.
 *
 * The audit and rank pipelines must NEVER import from
 * `modules/backlinks/` or `modules/competitors/`. A vendor outage in
 * either add-on panel can therefore never cascade into the core
 * products. The scan reads the raw source of the two core module
 * directories and hard-fails on any offending import path.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MODULES = join(HERE, '..');

const CORE_DIRS = ['audits', 'ranks'] as const;
const FORBIDDEN = ['../backlinks', '../competitors'] as const;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.d.ts'))
      files.push(p);
  }
  return files;
}

describe('architectural isolation — audit/rank ⊄ backlinks/competitors', () => {
  it.each(CORE_DIRS)(
    '%s module has zero imports from backlinks/competitors',
    async (core) => {
      const files = await walk(join(MODULES, core));
      const offenders: string[] = [];
      for (const f of files) {
        const src = await readFile(f, 'utf8');
        for (const bad of FORBIDDEN) {
          if (src.includes(`'${bad}`) || src.includes(`"${bad}`))
            offenders.push(`${f} → ${bad}`);
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});
