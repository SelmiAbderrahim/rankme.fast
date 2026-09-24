/**
 * Provider contract meta-check. Every registered adapter under
 * `shared/providers/dataforseo`, `shared/providers/google`, and
 * `shared/providers/summary` MUST ship an adjacent `<name>.test.ts` — the
 * suite that pins the vendor contract. A future adapter can't merge without
 * one because this meta-check discovers it and fails.
 *
 * The meta-check itself is deliberately tree-driven (not a hand-coded
 * allow-list) so adding a new adapter file automatically enrolls it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIRS = ['dataforseo', 'firecrawl', 'google', 'summary', 'resend'] as const;
/** Adapters here are intentionally not vendor calls (fake stubs, type-only, generated). */
const NON_CONTRACT_FILES = new Set([
  'fakes.ts',
  'types.ts',
  'index.ts',
]);

interface AdapterFile {
  vendor: string;
  file: string;
  fullPath: string;
}

function listAdapters(): AdapterFile[] {
  const out: AdapterFile[] = [];
  for (const vendor of VENDOR_DIRS) {
    const dir = join(HERE, vendor);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
      if (NON_CONTRACT_FILES.has(entry)) continue;
      out.push({ vendor, file: entry, fullPath: join(dir, entry) });
    }
  }
  return out;
}

describe('provider contract meta-check', () => {
  const adapters = listAdapters();

  it('discovers at least one adapter per shipped vendor family', () => {
    // Guards against a refactor that silently empties a vendor directory.
    const found = new Set(adapters.map((a) => a.vendor));
    expect(found.has('dataforseo')).toBe(true);
    expect(found.has('firecrawl')).toBe(true);
    expect(found.has('google')).toBe(true);
    expect(found.has('summary')).toBe(true);
    expect(found.has('resend')).toBe(true);
  });

  it.each(adapters)('$vendor/$file has an adjacent *.test.ts contract suite', ({ fullPath }) => {
    const contract = fullPath.replace(/\.ts$/, '.test.ts');
    expect(existsSync(contract), `missing contract test for ${fullPath}`).toBe(true);
  });

  it('enrolls both Firecrawl capability operations in the shared contract template', () => {
    const source = readFileSync(join(HERE, 'firecrawl', 'content-source.test.ts'), 'utf8');
    expect(source.match(/providerContractTests\(/g)).toHaveLength(2);
    expect(source).toContain("fixtureOperation: 'scrape'");
    expect(source).toContain("fixtureOperation: 'crawl'");
  });

  it('enrolls the three-leg domain comparison in the shared provider contract', () => {
    const source = readFileSync(join(HERE, 'dataforseo', 'labs-competitors.test.ts'), 'utf8');
    expect(source).toContain("title: 'DataForSeoCompetitorProvider.compareDomains'");
    expect(source).toContain("fixtureOperation: 'domain-comparison'");
    expect(source).toContain('mockCase: mockComparisonCase');
  });

  it('enrolls every AI SDK adapter in shared factory and normalized fixture contracts', () => {
    const aiSdkDir = join(HERE, 'ai-sdk');
    const adapters = {
      glm: 'createGlmAiSdkAdapter',
      deepseek: 'createDeepSeekAiSdkAdapter',
      kimi: 'createKimiAiSdkAdapter',
      openai: 'createOpenAiSdkAdapter',
      google: 'createGoogleAiSdkAdapter',
      anthropic: 'createAnthropicAiSdkAdapter',
    } as const;
    const factoryContract = readFileSync(join(aiSdkDir, 'factories.test.ts'), 'utf8');
    const responseContract = readFileSync(join(aiSdkDir, 'contract.test.ts'), 'utf8');
    for (const [adapter, factory] of Object.entries(adapters)) {
      expect(existsSync(join(aiSdkDir, `${adapter}.ts`))).toBe(true);
      expect(factoryContract).toContain(factory);
      expect(responseContract).toContain(`${adapter}:`);
    }
  });
});
