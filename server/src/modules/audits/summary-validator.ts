/**
 * Post-generation checks on an AI audit summary.
 *
 * The model may only restate what it was given. A summary is rejected when
 *   - it uses a number that does not appear in its input,
 *   - it makes an unsupported absolute claim ("guarantees", "will rank",
 *     "frequently quote"), in any of the seven output languages,
 *   - it names a web address other than the site and those in the input,
 *   - an item points at a finding that was not supplied.
 * A rejected summary is regenerated; it is never shown.
 */
import type { SummarizeInput, SummaryStructuredOutput } from '../../shared/providers/index.js';

export type SummaryValidationIssueKind =
  | 'unknown_number'
  | 'unsupported_claim'
  | 'unknown_url'
  | 'unknown_finding';

export interface SummaryValidationResult {
  ok: boolean;
  issues: SummaryValidationIssueKind[];
}

/**
 * Unsupported absolutes and overclaims, per output language. Matching is
 * case-insensitive on the summary text.
 */
export const UNSUPPORTED_CLAIM_PATTERNS: readonly RegExp[] = [
  // English
  /\bguarantee(?:s|d)?\b/iu,
  /\bwill (?:rank|outrank|boost|double|triple)\b/iu,
  /\b(?:frequently|often|always) (?:quote|quoted|quotes|cite|cited|cites)\b/iu,
  /\b(?:top|first) (?:spot|position|place) (?:on|in) google\b/iu,
  // French, German, Spanish
  /\bgaranti(?:t|e|es|ssons|ssent)?\b/iu,
  /\bgarantiert\b|\bgarantieren\b/iu,
  /\bgarantiza(?:do|da|mos|n)?\b/iu,
  // Russian
  /гарантир/iu,
  // Chinese
  /保证|确保排名|一定会排/u,
  // Arabic
  /نضمن|يضمن|مضمون/u,
];

const DIGIT_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0x0660, 0x0669], // Arabic-Indic
  [0x06f0, 0x06f9], // Extended Arabic-Indic
  [0xff10, 0xff19], // Fullwidth
];

/** Map every locale digit to ASCII so numbers compare across scripts. */
export function normalizeDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const block = DIGIT_BLOCKS.find(([start, end]) => code >= start && code <= end);
    out += block ? String(code - block[0]) : char;
  }
  return out;
}

/** Whole numbers in a text, thousands separators removed ("1,200" → 1200). */
export function numbersIn(text: string): number[] {
  const matches = normalizeDigits(text).match(/\d+(?:[.,\u00a0\u202f ]\d{3})*(?:[.,]\d+)?/gu) ?? [];
  return matches.map((raw) => {
    const grouped = /^\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+$/u.test(raw);
    const plain = grouped ? raw.replace(/[.,\u00a0\u202f ]/gu, '') : raw.replace(',', '.');
    return Number(plain);
  });
}

const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/giu;
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/giu;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const bareHost = (host: string): string => host.replace(/^www\./u, '');

/** Every string the summary was given, lower-cased, for "appears in input" checks. */
function inputCorpus(input: SummarizeInput): string {
  const parts: string[] = [input.siteDomain];
  for (const f of input.findings) parts.push(f.title, f.why, f.fix, ...(f.evidence ?? []));
  for (const d of input.dismissed ?? []) parts.push(d.title);
  return normalizeDigits(parts.join('\n')).toLowerCase();
}

/** Numbers the summary may use: every count it was given, and any number in its text. */
export function allowedNumbers(input: SummarizeInput): Set<number> {
  const allowed = new Set<number>();
  const fixNow = input.findings.filter((f) => f.priority === 'fix-now').length;
  const watch = input.findings.filter((f) => f.priority === 'watch').length;
  const dismissed = input.dismissed?.length ?? 0;
  for (const n of [fixNow, watch, fixNow + watch, dismissed, input.findings.length]) allowed.add(n);
  for (let n = 1; n <= Math.min(3, input.findings.length); n += 1) allowed.add(n);
  for (const f of input.findings) allowed.add(f.affectedCount);
  for (const d of input.dismissed ?? []) allowed.add(d.affectedCount);
  for (const n of numbersIn(inputCorpus(input))) allowed.add(n);
  return allowed;
}

function summaryTexts(output: { text: string; structured?: SummaryStructuredOutput | undefined }): string[] {
  if (!output.structured) return [output.text];
  return [
    output.structured.status,
    ...output.structured.items.flatMap((item) => [item.what, item.why, item.firstStep]),
  ];
}

/** Check one generated summary against the input it was built from. */
export function validateAuditSummary(
  output: { text: string; structured?: SummaryStructuredOutput | undefined },
  input: SummarizeInput,
): SummaryValidationResult {
  const issues = new Set<SummaryValidationIssueKind>();
  const text = summaryTexts(output).join('\n');
  const allowed = allowedNumbers(input);
  if (numbersIn(text).some((n) => !allowed.has(n))) issues.add('unknown_number');
  if (UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) issues.add('unsupported_claim');

  const corpus = inputCorpus(input);
  const site = bareHost(input.siteDomain.toLowerCase());
  const knownHost = (host: string) => bareHost(host) === site || corpus.includes(host);
  for (const url of text.match(URL_PATTERN) ?? []) {
    if (!knownHost(hostOf(url))) issues.add('unknown_url');
  }
  for (const domain of text.toLowerCase().match(DOMAIN_PATTERN) ?? []) {
    if (!knownHost(domain)) issues.add('unknown_url');
  }

  const ruleIds = new Set(input.findings.map((f) => f.ruleId));
  if (output.structured?.items.some((item) => !ruleIds.has(item.ruleId))) issues.add('unknown_finding');
  return { ok: issues.size === 0, issues: [...issues] };
}
