import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(import.meta.dirname, '..', '..');
function runtimeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? runtimeFiles(path) :
      entry.name.endsWith('.ts') && !/\.(?:test|spec)\.ts$/.test(entry.name) ? [path] : [];
  });
}
const whitespaceCount = /\.split\(\s*\/\\s\+\/[a-z]*\s*\)(?:\s*\.filter\([^)]*\))?\s*\.length/;
const whitespaceSplit = /\.split\(\s*\/\\s\+?\/[a-z]*\s*\)/;

describe('language-aware word counting boundary', () => {
  it('keeps whitespace-only word counters out of server runtime sources', () => {
    const offenders = runtimeFiles(sourceRoot).filter(file => whitespaceCount.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => relative(sourceRoot, file))).toEqual([]);
  });
  it('keeps audit text segmentation in the shared language-aware helper', () => {
    const offenders = runtimeFiles(join(sourceRoot, 'modules', 'audits')).filter(file => whitespaceSplit.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => relative(sourceRoot, file))).toEqual([]);
  });
});
