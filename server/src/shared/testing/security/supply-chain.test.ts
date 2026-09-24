import { ESLint } from 'eslint';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const MANIFESTS = ['server/package.json', 'client/package.json'] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause']);

function isIntelligenceDependency(name: string): boolean {
  return (
    name === '@modelcontextprotocol/sdk' ||
    name === 'ai' ||
    name.startsWith('@ai-sdk/') ||
    name === '@mendable/firecrawl-js' ||
    name === 'firecrawl'
  );
}

describe('SEC-SUPPLY import confinement', () => {
  const eslint = new ESLint({ cwd: join(REPOSITORY_ROOT, 'server') });

  it.each([
    ['src/modules/example.ts', "import '@modelcontextprotocol/sdk/server';"],
    ['src/modules/example.ts', "import 'ai';"],
    ['src/modules/example.ts', "import '@ai-sdk/openai';"],
    ['src/modules/example.ts', "import '@mendable/firecrawl-js';"],
  ])('rejects a confined SDK from %s', async (filePath, source) => {
    const [result] = await eslint.lintText(source, { filePath });
    expect(result?.messages.some(({ ruleId }) => ruleId === 'no-restricted-imports')).toBe(true);
  });

  it.each([
    ['src/modules/mcp/transport.ts', "import '@modelcontextprotocol/sdk/server';"],
    ['src/shared/providers/ai/runtime.ts', "import 'ai';"],
    ['src/shared/providers/firecrawl/client.ts', "import '@mendable/firecrawl-js';"],
  ])('allows a confined SDK in %s', async (filePath, source) => {
    const [result] = await eslint.lintText(source, { filePath });
    expect(result?.messages.filter(({ ruleId }) => ruleId === 'no-restricted-imports')).toEqual([]);
  });
});

describe('SEC-SUPPLY dependency manifests', () => {
  it('exact-pins and license-allows every installed intelligence dependency', () => {
    for (const relativeManifest of MANIFESTS) {
      const manifestPath = join(REPOSITORY_ROOT, relativeManifest);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
      for (const [name, version] of Object.entries(dependencies)) {
        if (!isIntelligenceDependency(name)) continue;
        expect(version, `${name} must use an exact version`).toMatch(EXACT_VERSION);
        const dependencyManifest = join(dirname(manifestPath), 'node_modules', name, 'package.json');
        expect(existsSync(dependencyManifest), `${name} must be installed for its license check`).toBe(true);
        const installed = JSON.parse(readFileSync(dependencyManifest, 'utf8')) as { license?: string };
        expect(ALLOWED_LICENSES.has(installed.license ?? ''), `${name} has disallowed license ${installed.license}`).toBe(true);
      }
    }
  });
});
