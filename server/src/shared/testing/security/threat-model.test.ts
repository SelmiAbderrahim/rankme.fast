import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const threatModel = readFileSync(
  resolve(__dirname, '../../../../../ops/security/threat-model.md'),
  'utf8',
);

describe('intelligence-expansion threat register', () => {
  it.each([
    'Crawled or competitor HTML → AI model',
    'Firecrawl webhook → API',
    'MCP JSON-RPC → API',
    'Public SSR guides and marketing → browser',
    'Superadmin control plane → operator',
    'Export payload → spreadsheet software',
    'Server-side outbound URL → arbitrary host',
  ])('registers boundary %s', (boundary) => {
    expect(threatModel).toContain(`| ${boundary} |`);
  });

  it.each([
    'SEC-URL',
    'SEC-DENY',
    'SEC-REDACT',
    'SEC-BOUND',
    'SEC-INJECT',
    'SEC-OUT',
    'SEC-RATE',
    'SEC-SUPPLY',
    'SEC-SECRET',
  ])('maps control %s to a shared authority and its evidence', (control) => {
    const row = threatModel.split('\n').find((line) => line.startsWith(`| ${control} |`));
    expect(row).toBeDefined();
    expect(row?.split('|')).toHaveLength(6);
    expect(row).toContain('`');
  });
});
