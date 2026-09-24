import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V1_CSV_CONTRACTS } from '../../modules/public-api/v1.csv.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'tools', 'looker-connector');

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

const code = readFileSync(resolve(ARTIFACT_DIR, 'Code.gs'), 'utf8');
const manifestText = readFileSync(resolve(ARTIFACT_DIR, 'appsscript.json'), 'utf8');
const connectorReadme = readFileSync(resolve(ARTIFACT_DIR, 'README.md'), 'utf8');
const localizedDocs = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']
  .map((locale) => read(`docs/looker-studio.${locale}.md`))
  .join('\n');
const localizedPublicApiDocs = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']
  .map((locale) => read(`docs/public-api.${locale}.md`))
  .join('\n');

describe('Looker Studio source artifact', () => {
  it('implements the required KEY-auth connector functions and every CSV field', () => {
    for (const functionName of [
      'getAuthType',
      'setCredentials',
      'isAuthValid',
      'resetAuth',
      'getConfig',
      'getSchema',
      'getData',
    ]) {
      expect(code).toContain(`function ${functionName}(`);
    }
    expect(code).toContain('cc.AuthType.KEY');
    expect(code).toContain('PropertiesService.getUserProperties()');
    expect(code).not.toMatch(/newTextInput\(\)[\s\S]{0,120}setId\(['"](?:api)?key/iu);

    for (const [dataset, columns] of Object.entries(V1_CSV_CONTRACTS)) {
      for (const column of columns) {
        expect(
          code.includes(`field('${column.header}'`) || code.includes(`metric('${column.header}'`),
          `${dataset}: ${column.header}`,
        ).toBe(true);
      }
    }
  });

  it('keeps the artifact and localized docs secret-free with no fixed instance origin', () => {
    const combined = `${code}\n${manifestText}\n${connectorReadme}\n${localizedDocs}`;
    for (const forbidden of [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
      /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
      /\brmf_[A-Za-z0-9_-]{20,}\b/u,
      /authorization\s*[:=]\s*['"]Bearer\s+rmf_/iu,
      /AIza[0-9A-Za-z_-]{35}/u,
    ]) {
      expect(combined).not.toMatch(forbidden);
    }
    expect(code).not.toMatch(/(?:localhost|127\.0\.0\.1|rankme\.fast)/iu);
    expect(code).not.toMatch(/(?:API_BASE|SERVER_URL|INSTANCE_ORIGIN)\s*=/u);
    expect(code).toContain('config.instanceUrl');
    expect(manifestText).not.toContain('urlFetchWhitelist');
    expect(localizedDocs).not.toMatch(
      /https?:\/\/(?:localhost|127\.0\.0\.1|rankme\.fast)(?:[/:?#]|$)/iu,
    );
  });

  it('has a valid inert manifest and dated official documentation citations', () => {
    const manifest = JSON.parse(manifestText) as {
      runtimeVersion?: string;
      dataStudio?: { authType?: string[] };
      oauthScopes?: string[];
    };
    expect(manifest.runtimeVersion).toBe('V8');
    expect(manifest.dataStudio?.authType).toEqual(['KEY']);
    expect(manifest.oauthScopes).toContain(
      'https://www.googleapis.com/auth/script.external_request',
    );
    expect(connectorReadme).toContain('Retrieved 2026-08-04');
    for (const path of ['build', 'auth', 'reference', 'manifest']) {
      expect(connectorReadme).toContain(
        `https://developers.google.com/looker-studio/connector/${path}`,
      );
    }
  });

  it('pages all four cursor datasets with bounds and repeated-cursor defense', () => {
    expect(code.match(/paginated: true/gu)).toHaveLength(4);
    expect(code).toContain('if (DATASETS[config.dataset].paginated)');
    expect(code).toContain('rank_history: 10');
    expect(code.match(/: 1000/gu)).toHaveLength(3);
    expect(code).toContain("query.push('limit=' + PAGE_SIZES[config.dataset])");
    expect(code).toContain("if (cursor) query.push('cursor=' + encodeURIComponent(cursor))");
    expect(code).toContain('fetchCsvRows(selected, request && request.dateRange)');
    expect(code).toContain("query.push('from=' + encodeURIComponent(from))");
    expect(code).toContain("query.push('to=' + encodeURIComponent(to))");
    expect(code).toContain("endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'");
    expect(code).toContain('var MAX_CONNECTOR_ROWS = 10000');
    expect(code).toContain('var seenCursors = {}');
    expect(code).toContain('else if (seenCursors[next])');
    expect(connectorReadme).toContain('Rank history requests 10 keyword groups');
    expect(localizedDocs).toContain('10,000');
    expect(localizedPublicApiDocs.match(/X-Next-Cursor/gu)).toHaveLength(7);
  });

  it('sits outside both Vitest include globs without an added exclusion', () => {
    const serverConfig = read('server/vitest.config.ts');
    const clientConfig = read('client/vitest.config.ts');
    expect(serverConfig).toContain("include: ['src/**/*.{test,spec}.ts']");
    expect(clientConfig).toContain("include: ['src/**/*.{test,spec}.{ts,tsx}']");
    expect(serverConfig).not.toContain('looker-connector');
    expect(clientConfig).not.toContain('looker-connector');
    expect(ARTIFACT_DIR.startsWith(resolve(REPO_ROOT, 'tools'))).toBe(true);
  });
});
