import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkTestPolicy,
  formatViolation,
  runTestPolicy,
  scanTestRoots,
} from './skip-policy.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('checkTestPolicy', () => {
  const forbidden = [
    'it.skip("x", fn)',
    'test.skip("x", fn)',
    'describe.skip("x", fn)',
    'xit("x", fn)',
    'xtest("x", fn)',
    'xdescribe("x", fn)',
    'it.todo("x")',
    'test.todo("x")',
    'it.only("x", fn)',
    'test.only("x", fn)',
    'describe.only("x", fn)',
    'fit("x", fn)',
    'ftest("x", fn)',
    'fdescribe("x", fn)',
    'test.describe.skip("x", fn)',
    'test.describe.only("x", fn)',
    'test.describe.serial.only("x", fn)',
    'test . describe . serial . skip ("x", fn)',
    'test.concurrent.only ("x", fn)',
    'describe . sequential . skip\n("x", fn)',
  ];

  it.each(forbidden)('rejects %s', (source) => {
    const violations = checkTestPolicy('case.test.ts', source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'case.test.ts', line: 1 });
  });

  it('reports every finding with its file and one-based line', () => {
    const violations = checkTestPolicy(
      'multiple.spec.ts',
      ['it("ok", fn)', 'test.todo("later")', '', 'describe.only("focus", fn)'].join('\n'),
    );
    expect(violations.map(({ line, token }) => ({ line, token }))).toEqual([
      { line: 2, token: 'test.todo' },
      { line: 4, token: 'describe.only' },
    ]);
  });

  it('ignores comments, prose strings, templates, production methods, and properties', () => {
    const source = [
      '// test.only("comment", fn)',
      '/* describe.skip("block", fn) */',
      'const a = "it.todo(\\"string\\")";',
      "const b = 'fit(\"string\", fn)';",
      'const c = `xdescribe("template", fn)`;',
      'resource.skip(3);',
      'object.test.only("not a test global", fn);',
      'const testOnly = () => undefined;',
    ].join('\n');
    expect(checkTestPolicy('clean.ts', source)).toEqual([]);
  });

  it('handles clean, empty, CRLF, and malformed unterminated input', () => {
    expect(checkTestPolicy('empty.ts', '')).toEqual([]);
    expect(checkTestPolicy('clean.ts', 'it("passes", fn);\r\n')).toEqual([]);
    expect(checkTestPolicy('malformed.ts', 'const prose = "test.only(')).toEqual([]);
    expect(checkTestPolicy('malformed.ts', '/* test.skip("x", fn)')).toEqual([]);
    expect(checkTestPolicy('multiline.ts', 'const prose = "line one\nline two";')).toEqual([]);
  });
});

describe('repository policy runner', () => {
  function makeRoots(): string[] {
    const base = mkdtempSync(join(tmpdir(), 'test-policy-'));
    tempRoots.push(base);
    const roots = ['server/src', 'client/src', 'client/e2e'].map((path) => join(base, path));
    for (const root of roots) mkdirSync(root, { recursive: true });
    return roots;
  }

  it('scans server, client, and e2e roots and ignores non-test source', () => {
    const roots = makeRoots();
    writeFileSync(join(roots[0]!, 'server.test.ts'), 'it("ok", fn)');
    writeFileSync(join(roots[1]!, 'client.spec.tsx'), 'test.todo("later")');
    writeFileSync(join(roots[2]!, 'journey.spec.ts'), 'test.only("focus", fn)');
    writeFileSync(join(roots[2]!, 'helper.ts'), 'describe.skip("not collected", fn)');
    expect(scanTestRoots(roots).map((finding) => finding.token)).toEqual([
      'test.only',
      'test.todo',
    ]);
  });

  it('returns zero for clean roots and one with every formatted violation otherwise', () => {
    const roots = makeRoots();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const output = { out: (line: string) => stdout.push(line), error: (line: string) => stderr.push(line) };
    expect(runTestPolicy(roots, output)).toBe(0);
    expect(stdout).toEqual(['test-policy: clean']);

    writeFileSync(join(roots[0]!, 'bad.test.ts'), 'it.skip("x", fn)\nfit("y", fn)');
    expect(runTestPolicy(roots, output)).toBe(1);
    expect(stderr).toHaveLength(3);
    expect(stderr[0]).toContain('bad.test.ts:1');
    expect(stderr[1]).toContain('bad.test.ts:2');
    expect(stderr[2]).toBe('test-policy: 2 violation(s)');
  });

  it('ignores generated dependency and coverage directories while walking', () => {
    const roots = makeRoots();
    for (const directory of ['node_modules', 'dist', 'coverage']) {
      const ignored = join(roots[0]!, directory);
      mkdirSync(ignored, { recursive: true });
      writeFileSync(join(ignored, 'ignored.test.ts'), 'test.only("ignored", fn)');
    }
    expect(scanTestRoots(roots)).toEqual([]);
  });

  it('recurses through ordinary source directories', () => {
    const roots = makeRoots();
    const nested = join(roots[1]!, 'feature', 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'focused.test.tsx'), 'fdescribe("nested", fn)');
    expect(scanTestRoots(roots)).toEqual([
      expect.objectContaining({ token: 'fdescribe', line: 1 }),
    ]);
  });

  it('returns one for missing arguments and unreadable roots', () => {
    const errors: string[] = [];
    const output = { out: () => undefined, error: (line: string) => errors.push(line) };
    expect(runTestPolicy([], output)).toBe(1);
    expect(runTestPolicy(['/definitely/missing/test-root'], output)).toBe(1);
    expect(errors[0]).toContain('usage:');
    expect(errors[1]).toContain('test-policy:');
  });
});

describe('formatViolation', () => {
  it('includes file, line, token, and source text', () => {
    expect(
      formatViolation({
        file: 'a.test.ts',
        line: 3,
        token: 'test.only',
        text: 'test.only("x", fn)',
      }),
    ).toBe('a.test.ts:3: forbidden test construct `test.only` — test.only("x", fn)');
  });
});
