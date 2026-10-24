// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const aliases = [['@features/', 'features/'], ['@shared/', 'shared/'], ['@app/', 'app/'], ['@/', '']] as const;
function resolveImport(from: string, specifier: string): string | null {
  const alias = aliases.find(([prefix]) => specifier.startsWith(prefix));
  const base = specifier.startsWith('.') ? resolve(dirname(from), specifier) : alias ? join(SRC, alias[1], specifier.slice(alias[0].length)) : null;
  if (!base) return null;
  for (const path of [base, ...['.ts', '.tsx', '.json', '.css', '/index.ts', '/index.tsx'].map((extension) => base.replace(/\.js$/, '') + extension)]) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  throw new Error(`Unresolved local import ${specifier} from ${relative(SRC, from)}`);
}
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>(), queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length && statement.exportClause.elements.every((item) => item.isTypeOnly)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        const named = clause?.namedBindings;
        if (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length && named.elements.every((item) => item.isTypeOnly)) continue;
      }
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const target = resolveImport(file, specifier.text);
      if (target) queue.push(target);
    }
  }
  return seen;
}

it('follows real runtime edges without treating type exports or dynamic imports as eager code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'client-import-boundary-'));
  try {
    writeFileSync(join(directory, 'entry.ts'), "import './surface.css';\nexport { value } from './runtime';\nexport { type Hidden } from './hidden';\nimport { type Hidden } from './hidden';\nvoid import('./lazy');");
    writeFileSync(join(directory, 'runtime.ts'), 'export const value = 1;');
    writeFileSync(join(directory, 'hidden.ts'), 'export interface Hidden {}');
    writeFileSync(join(directory, 'lazy.ts'), 'export const view = 1;');
    writeFileSync(join(directory, 'surface.css'), 'body {}');
    expect([...staticGraph(join(directory, 'entry.ts'))].map((file) => relative(directory, file)).sort()).toEqual(['entry.ts', 'runtime.ts', 'surface.css']);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

describe('browser entry boundaries', () => {
  const reachable = [...staticGraph(join(SRC, 'entry-client.tsx'))].map((file) => relative(SRC, file).replaceAll('\\', '/')).sort();
  it('loads documentation chrome while article and search views stay lazy', () => {
    expect(reachable.filter((file) => file.startsWith('features/docs/'))).toEqual([
      'features/docs/components/DocsError.tsx',
      'features/docs/components/DocsLayout.tsx',
      'features/docs/index.ts',
      'features/docs/loaders.ts',
      'features/docs/routes.tsx',
      'features/docs/types.ts',
    ]);
    expect(readFileSync(join(SRC, 'features/docs/routes.tsx'), 'utf8')).toContain("import('./components/DocsArticle')");
  });
  it('keeps non-English dictionaries lazy and the shared English app fallback reachable', () => {
    expect(reachable.filter((file) => /locales\/(?!en\/)[a-z]{2}\/.*\.json$/.test(file))).toEqual([]);
    expect(reachable).toContain('shared/i18n/locales/en/common.json');
    expect(reachable).toContain('shared/i18n/locales/en/docs.json');
  });
});

describe('chunk boundaries', () => {
  // Read only the pure callback. Calling the config factory would load the
  // operator environment, which unit tests must never inspect.
  const filename = resolve(SRC, '../vite.config.ts');
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'manualChunk');
  if (!declaration) throw new Error('Missing chunk assignment callback');
  const callback = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const chunkOf = runInNewContext(`${callback}\nmanualChunk`, {}, { timeout: 1000 }) as (id: string) => string | undefined;
  const at = (path: string) => `/repo/client/src/${path}`;
  it('does not pin documentation views or route chrome into a shared feature chunk', () => {
    for (const path of ['features/docs/components/DocsArticle.tsx', 'features/docs/components/DocsHome.tsx', 'features/docs/components/DocsLayout.tsx', 'features/docs/routes.tsx']) expect(chunkOf(at(path))).toBeUndefined();
  });
  it('separates English documentation copy from app copy and retains workspace grouping', () => {
    const common = chunkOf(at('shared/i18n/locales/en/common.json'));
    expect(common).toBe('locale-en-app');
    expect(chunkOf(at('shared/i18n/locales/en/docs.json'))).toBeDefined();
    expect(chunkOf(at('shared/i18n/locales/en/docs.json'))).not.toBe(common);
    expect(chunkOf(at('features/workspace/api.ts'))).toBe('workspace-team');
  });
});
