/**
 * Deterministic conversation titles. No model call, no
 * spend: the first user message is condensed into a short, sentence-case
 * subject, a linked site's domain disambiguates subject-less starter prompts,
 * and a numeric suffix keeps every title on the account unique.
 *
 * Titles are untrusted user text: they stay plain strings and are rendered as
 * React text nodes by the client.
 */
import { translate } from '../../shared/i18n/index.js';

/** Visible length of the condensed subject before the optional site suffix. */
export const CHAT_TITLE_SUBJECT_CHARS = 60;
/** Longest domain appended as a suffix. */
const CHAT_TITLE_DOMAIN_CHARS = 40;
const SEPARATOR = ' · ';

/** Polite / conversational lead-ins removed (repeatedly) from the start. */
const LEAD_INS: readonly RegExp[] = [
  // English
  /^(?:hi|hello|hey|hola|bonjour|hallo)\b[\s,!.:-]*/iu,
  /^(?:please|kindly|pls)\b[\s,:-]*/iu,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+|kindly\s+)?(?:help\s+me\s+(?:to\s+)?)?/iu,
  /^(?:i(?:'|’)d|i\s+would|i)\s+(?:like|want|need)\s+(?:you\s+)?to\s+/iu,
  /^(?:help\s+me\s+(?:to\s+)?)/iu,
  /^(?:thanks|thank\s+you)[\s,!.:-]*/iu,
  // French
  /^(?:s(?:'|’)il\s+(?:vous|te)\s+pla[iî]t|pouvez-vous|peux-tu|pourriez-vous)\b[\s,:-]*/iu,
  // German
  /^(?:bitte|kannst\s+du|k[oö]nnen\s+sie|k[oö]nntest\s+du)\b[\s,:-]*/iu,
  // Spanish
  /^(?:por\s+favor|puedes|podr[ií]as|puede\s+usted)\b[\s,:-]*/iu,
  // Russian
  /^(?:пожалуйста|привет|здравствуйте)[\s,!.:-]*/iu,
  // Arabic
  /^(?:مرحبا|أهلا|من فضلك|رجاء)[\s،,!.:-]*/u,
  // Chinese
  /^(?:请问|请|你好|您好|麻烦)[\s，,!.！:：-]*/u,
];

const SENTENCE_END = /[.!?؟。！？\n\r;；](?:\s|$)|[。！？]/u;

/** Strip markdown / URLs / tool directives so the subject is readable prose. */
function stripNoise(text: string): string {
  return text
    .replace(/\[tool:[^\]]*\]/giu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\bhttps?:\/\/\S+/giu, ' ')
    .replace(/^[\s>#*\-+\d.)]+(?=\p{L})/gmu, '')
    .replace(/[*_~#>|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripLeadIns(text: string): string {
  let current = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = current;
    for (const pattern of LEAD_INS) current = current.replace(pattern, '').trimStart();
    if (current === before) break;
  }
  return current;
}

/** Cut at a word boundary (locale-aware, so CJK is not cut mid-word). */
function truncateOnWordBoundary(text: string, limit: number, locale: string): string {
  const codepoints = Array.from(text);
  if (codepoints.length <= limit) return text;
  let out = '';
  let count = 0;
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  for (const part of segmenter.segment(text)) {
    const size = Array.from(part.segment).length;
    if (count + size > limit) break;
    out += part.segment;
    count += size;
  }
  out = out.trimEnd();
  // A single unbroken token longer than the limit: hard cut on a codepoint.
  if (out.length === 0) out = codepoints.slice(0, limit).join('').trimEnd();
  return `${out.replace(/[\s,;:\-–—]+$/u, '')}…`;
}

function sentenceCase(text: string, locale: string): string {
  return text.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
}

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Condense a free-form message into a short subject line, or '' when nothing
 * readable is left (empty, emoji-only, URL-only).
 */
export function condenseTitleSubject(text: string, locale: string): string {
  const cleaned = stripLeadIns(stripNoise(text));
  if (!HAS_LETTER_OR_DIGIT.test(cleaned)) return '';
  const match = SENTENCE_END.exec(cleaned);
  const lead = (match ? cleaned.slice(0, match.index + 1) : cleaned)
    .replace(/[\s,;:\-–—.]+$/u, '')
    .trim();
  const clause = HAS_LETTER_OR_DIGIT.test(lead) ? lead : cleaned;
  const bounded = truncateOnWordBoundary(clause, CHAT_TITLE_SUBJECT_CHARS, locale);
  return sentenceCase(bounded, locale);
}

/**
 * Worst case: 61-char subject + separator + 40-char domain + separator + a
 * 4-digit counter stays under CHAT_TITLE_MAX_CHARS, so no clipping is needed.
 */
function withSuffix(subject: string, suffix: string): string {
  return `${subject}${SEPARATOR}${suffix}`;
}

export interface BuildTitleInput {
  /** First user message. */
  text: string;
  /** Conversation locale (used for casing, word boundaries, and the fallback). */
  locale: string;
  /** Linked site's domain, when the conversation has one. */
  siteDomain: string | null;
  /** Titles already used on the account (case-insensitive uniqueness). */
  existingTitles: readonly string[];
}

/**
 * Build a unique title: condensed subject, plus the site domain when the
 * message names no subject site, plus ` · N` when it would still collide.
 */
export function buildConversationTitle(input: BuildTitleInput): string {
  const taken = new Set(input.existingTitles.map((title) => title.toLocaleLowerCase()));
  const subject = condenseTitleSubject(input.text, input.locale);
  if (subject === '') {
    return uniqueTitle(translate(input.locale, 'chat.titles.untitled'), null, taken);
  }
  const domain = input.siteDomain?.trim().toLocaleLowerCase() ?? '';
  const mentionsDomain =
    domain !== '' &&
    (subject.toLocaleLowerCase().includes(domain) ||
      input.text.toLocaleLowerCase().includes(domain));
  const shortDomain =
    domain === ''
      ? null
      : Array.from(domain).slice(0, CHAT_TITLE_DOMAIN_CHARS).join('');
  return uniqueTitle(subject, mentionsDomain ? null : shortDomain, taken);
}

function uniqueTitle(subject: string, domain: string | null, taken: Set<string>): string {
  const base = domain ? withSuffix(subject, domain) : subject;
  if (!taken.has(base.toLocaleLowerCase())) return base;
  // `taken` is finite (retention caps an account at 100 conversations), so a
  // free counter always exists.
  for (let n = 2; ; n += 1) {
    const candidate = withSuffix(base, String(n));
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
