/**
 * Architectural separation between customer alert channels and the platform
 * failure-alert sink. Customer rules must only use their persisted, encrypted
 * channel configuration; the operator-only ALERT_WEBHOOK_URL is never a
 * delivery fallback or destination inside this feature.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ALERTS_ROOT = fileURLToPath(new URL('.', import.meta.url));

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await productionSources(path)));
    else if (
      entry.isFile() &&
      path.endsWith('.ts') &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.spec.ts') &&
      !path.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files.sort();
}

function inspectSource(path: string, source: string): string[] {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const findings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'env' &&
      node.name.text === 'ALERT_WEBHOOK_URL'
    ) {
      findings.push('reads env.ALERT_WEBHOOK_URL');
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'env' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'ALERT_WEBHOOK_URL'
    ) {
      findings.push('reads env[ALERT_WEBHOOK_URL]');
    }
    if (ts.isIdentifier(node) && node.text === 'sendFailureAlert') {
      findings.push('references sendFailureAlert');
    }
    if (
      ts.isStringLiteralLike(node) &&
      /(?:^|[@/])shared\/utils\/failure-alert(?:\.js)?$/u.test(node.text)
    ) {
      findings.push('reaches shared/utils/failure-alert');
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...new Set(findings)];
}

describe('alerts architectural boundaries', () => {
  it('cannot use the operator failure-alert destination or sender', async () => {
    const findings: string[] = [];
    const sources = await productionSources(ALERTS_ROOT);
    expect(sources.length).toBeGreaterThan(0);
    for (const path of sources) {
      const source = await readFile(path, 'utf8');
      for (const finding of inspectSource(path, source)) {
        findings.push(`${relative(ALERTS_ROOT, path)}: ${finding}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('detects exact forbidden constructs without matching comments or prefix constants', () => {
    expect(
      inspectSource(
        'safe.ts',
        `
          const ALERT_WEBHOOK_URL_MAX_CHARS = 2048;
          // env.ALERT_WEBHOOK_URL and sendFailureAlert are forbidden in production.
        `,
      ),
    ).toEqual([]);

    expect(
      new Set(
        inspectSource(
          'unsafe.ts',
          `
            import { sendFailureAlert } from '../../shared/utils/failure-alert.js';
            env.ALERT_WEBHOOK_URL;
            env['ALERT_WEBHOOK_URL'];
            void sendFailureAlert({ subject: 'x', body: 'y' });
          `,
        ),
      ),
    ).toEqual(
      new Set([
        'reads env.ALERT_WEBHOOK_URL',
        'reads env[ALERT_WEBHOOK_URL]',
        'references sendFailureAlert',
        'reaches shared/utils/failure-alert',
      ]),
    );
  });
});
