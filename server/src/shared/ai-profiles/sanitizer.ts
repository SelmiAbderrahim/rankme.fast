import { boundedRegexTest } from '../security/input-guards.js';
import type { AiProfileSafetyWarning, AiTaskProfile } from './types.js';
const UNKNOWN_FIELD_MAX_CHARACTERS = 4000;
const MAX_DEPTH = 12;
const MAX_NODES = 10000;
const ACTIVE_CONTENT_PATTERNS = [
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/giu,
    /<style\b[^>]*>[\s\S]*?<\/style\s*>/giu,
    /<form\b[^>]*>[\s\S]*?<\/form\s*>/giu,
    /<\/?(?:script|style|form|input|button|textarea|select|option)\b[^>]*>/giu,
] as const;
const REMOTE_LINK_PATTERNS = [
    { pattern: /\[([^\]]{0,500})\]\(https?:\/\/[^\s)]+\)/giu, replacement: '$1' },
    { pattern: /https?:\/\/[^\s<>{}[\]]+/giu, replacement: '' },
] as const;
const INSTRUCTION_PATTERNS = [
    /\bignore\s+(?:all\s+)?previous\s+instructions?\b/giu,
    /\b(?:reveal|print|show|repeat)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions?)\b/giu,
    /\b(?:act|behave)\s+as\s+(?:the\s+)?(?:system|developer|assistant)\b/giu,
    /\bcall\s+(?:every|all|the)\s+(?:available\s+)?tools?\b/giu,
] as const;
function boundedReplace(value: string, pattern: RegExp, replacement: string): {
    value: string;
    changed: boolean;
} {
    if (!boundedRegexTest(pattern, value, value.length || 1))
        return { value, changed: false };
    pattern.lastIndex = 0;
    const next = value.replace(pattern, replacement);
    return { value: next, changed: next !== value };
}
function removeControlCharacters(value: string): {
    value: string;
    changed: boolean;
} {
    const next = [...value]
        .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 0x0a || code === 0x09 || (code > 0x1f && (code < 0x7f || code > 0x9f));
    })
        .join('');
    return { value: next, changed: next !== value };
}
function deduplicateLines(value: string): {
    value: string;
    changed: boolean;
} {
    const seen = new Set<string>();
    const kept: string[] = [];
    let changed = false;
    for (const line of value.split('\n')) {
        const normalized = line.trim().replace(/\s+/gu, ' ');
        if (normalized.length > 40 && seen.has(normalized)) {
            changed = true;
            continue;
        }
        if (normalized.length > 40)
            seen.add(normalized);
        kept.push(line);
    }
    return { value: kept.join('\n'), changed };
}
function sanitizeString(raw: string, maximumCharacters: number, warnings: Set<AiProfileSafetyWarning>): string {
    let value = raw;
    if (value.length > maximumCharacters) {
        value = value.slice(0, maximumCharacters);
        warnings.add('input_truncated');
    }
    const controls = removeControlCharacters(value);
    value = controls.value;
    if (controls.changed)
        warnings.add('control_characters_removed');
    for (const pattern of ACTIVE_CONTENT_PATTERNS) {
        const result = boundedReplace(value, pattern, ' ');
        value = result.value;
        if (result.changed)
            warnings.add('active_content_removed');
    }
    for (const { pattern, replacement } of REMOTE_LINK_PATTERNS) {
        const result = boundedReplace(value, pattern, replacement);
        value = result.value;
        if (result.changed)
            warnings.add('remote_link_removed');
    }
    for (const pattern of INSTRUCTION_PATTERNS) {
        const result = boundedReplace(value, pattern, '[instruction-like text removed]');
        value = result.value;
        if (result.changed)
            warnings.add('instruction_phrase_removed');
    }
    const deduplicated = deduplicateLines(value);
    if (deduplicated.changed)
        warnings.add('repeated_text_removed');
    return deduplicated.value.normalize('NFC').trim();
}
export interface SanitizedProfileInput {
    value: object;
    warnings: readonly AiProfileSafetyWarning[];
}
export function sanitizeProfileInput(input: unknown, profile: AiTaskProfile): SanitizedProfileInput {
    const warnings = new Set<AiProfileSafetyWarning>();
    const state = { nodes: 0 };
    const visit = (value: unknown, property: string, depth: number): unknown => {
        state.nodes += 1;
        if (state.nodes > MAX_NODES || depth > MAX_DEPTH)
            throw new Error('ai_profile_input_too_complex');
        if (typeof value === 'string') {
            return sanitizeString(value, profile.maximumCharacters[property] ?? UNKNOWN_FIELD_MAX_CHARACTERS, warnings);
        }
        if (Array.isArray(value))
            return value.map((item) => visit(item, property, depth + 1));
        if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, key, depth + 1)]));
        }
        return value;
    };
    const visited = visit(input, '', 0);
    const parsed = profile.inputSchema.safeParse(visited);
    if (!parsed.success)
        throw new Error('invalid_ai_profile_input', { cause: parsed.error });
    return { value: parsed.data, warnings: [...warnings] };
}
