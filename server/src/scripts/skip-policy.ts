import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const FORBIDDEN_TEST_CONSTRUCT = /(?<![\w$.])(?:(?:it|test|describe)(?:\s*\.\s*(?:concurrent|sequential|serial|describe))*\s*\.\s*(?:skip|todo|only)|(?:xit|xtest|xdescribe|fit|ftest|fdescribe))\s*\(/g;
export interface TestPolicyViolation {
    file: string;
    line: number;
    token: string;
    text: string;
}
export interface PolicyOutput {
    out(message: string): void;
    error(message: string): void;
}
/**
 * Blank comments and prose strings while preserving offsets and newlines. The
 * scanner remains bounded and lexical: test source is never imported or run.
 */
function executableText(content: string): string {
    type State = 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template';
    let state: State = 'code';
    let escaped = false;
    let result = '';
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index]!;
        const next = content[index + 1];
        if (state === 'code') {
            if (char === '/' && next === '/') {
                result += '  ';
                index += 1;
                state = 'line-comment';
            }
            else if (char === '/' && next === '*') {
                result += '  ';
                index += 1;
                state = 'block-comment';
            }
            else if (char === "'") {
                result += ' ';
                state = 'single';
            }
            else if (char === '"') {
                result += ' ';
                state = 'double';
            }
            else if (char === '`') {
                result += ' ';
                state = 'template';
            }
            else {
                result += char;
            }
            continue;
        }
        if (char === '\n') {
            result += '\n';
            if (state === 'line-comment')
                state = 'code';
            continue;
        }
        result += ' ';
        if (state === 'line-comment')
            continue;
        if (state === 'block-comment') {
            if (char === '*' && next === '/') {
                result += ' ';
                index += 1;
                state = 'code';
            }
            continue;
        }
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if ((state === 'single' && char === "'") ||
            (state === 'double' && char === '"') ||
            (state === 'template' && char === '`')) {
            state = 'code';
        }
    }
    return result;
}
/** Find every executable skip, todo, or focused-test construct in source text. */
export function checkTestPolicy(file: string, content: string): TestPolicyViolation[] {
    const executable = executableText(content);
    const sourceLines = content.split(/\r?\n/);
    const violations: TestPolicyViolation[] = [];
    let currentLine = 1;
    let cursor = 0;
    FORBIDDEN_TEST_CONSTRUCT.lastIndex = 0;
    for (const match of executable.matchAll(FORBIDDEN_TEST_CONSTRUCT)) {
        const offset = match.index;
        for (let index = cursor; index < offset; index += 1) {
            if (executable[index] === '\n')
                currentLine += 1;
        }
        cursor = offset;
        const token = match[0]
            .replace(/\s*\($/, '')
            .replace(/\s+/g, '')
            .replace(/\.(concurrent|sequential|serial)(?=\.)/g, '');
        violations.push({
            file,
            line: currentLine,
            token,
            text: sourceLines[currentLine - 1]!.trim(),
        });
    }
    return violations;
}
/** Backwards-compatible name for callers of the original skip-only policy. */
export const checkSkipPolicy = checkTestPolicy;
/** Human-readable one-liner for CI logs. */
export function formatViolation(violation: TestPolicyViolation): string {
    return `${violation.file}:${violation.line}: forbidden test construct \`${violation.token}\` — ${violation.text}`;
}
function walk(root: string, files: string[]): void {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
            continue;
        }
        const path = join(root, entry.name);
        if (entry.isDirectory())
            walk(path, files);
        else if (TEST_FILE.test(entry.name))
            files.push(path);
    }
}
/** Scan all supplied roots in one deterministic invocation. */
export function scanTestRoots(roots: readonly string[]): TestPolicyViolation[] {
    const files: string[] = [];
    for (const root of roots)
        walk(root, files);
    return files.sort().flatMap((file) => checkTestPolicy(file, readFileSync(file, 'utf8')));
}
/** Runner core. Returns the process exit code without terminating the caller. */
export function runTestPolicy(roots: readonly string[], output: PolicyOutput): number {
    if (roots.length === 0) {
        output.error('usage: tsx src/scripts/run-skip-policy.ts <root1> [...more]');
        return 1;
    }
    let violations: TestPolicyViolation[];
    try {
        violations = scanTestRoots(roots);
    }
    catch (error) {
        output.error(`test-policy: ${String(error)}`);
        return 1;
    }
    if (violations.length === 0) {
        output.out('test-policy: clean');
        return 0;
    }
    for (const violation of violations)
        output.error(formatViolation(violation));
    output.error(`test-policy: ${violations.length} violation(s)`);
    return 1;
}
