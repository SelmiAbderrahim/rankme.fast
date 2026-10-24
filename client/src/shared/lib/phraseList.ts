/** One parser for pasted lists, previews and chip inputs. Spaces stay inside phrases. */
const SEPARATORS = new Set([',', ';', '،', '؛', '，', '；', '、']);
const SEPARATOR_CHARS = /[\r\n\t,;،؛，；、]/;
const QUOTE_PAIRS: Readonly<Record<string, string>> = { '"': '"', '“': '”"' };
const WRAPPING_QUOTES = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»'], ['「', '」']] as const;
const NUMBER_PREFIX = /^\(?\d{1,3}[.)]\s+/;
const BULLET_PREFIX = /^(?:[•·▪◦‣●○■□►▸➤✓✔*]\s*|[-–—]\s+)/u;
const NUMERIC_CELL = /^[\d\s.,%$€£¥+\-–]*\d[\d\s.,%$€£¥+\-–]*$/;

export const hasPhraseSeparator = (raw: string): boolean => SEPARATOR_CHARS.test(raw);
export const cleanPhrase = (phrase: string): string => phrase.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
export const normalizePhraseKey = (phrase: string): string => cleanPhrase(cleanPhrase(phrase).normalize('NFKC').toLowerCase());

function stripWrappingQuotes(phrase: string): string {
  for (const [open, close] of WRAPPING_QUOTES) {
    if (phrase.length >= 2 && phrase.startsWith(open) && phrase.endsWith(close)) return cleanPhrase(phrase.slice(open.length, -close.length));
  }
  return phrase;
}

interface Token { text: string; column: number; }

function tokenizeLine(line: string): Token[] {
  const literalQuotes = new Set<number>();
  for (;;) {
    const tokens: Token[] = [];
    let column = 0;
    let buffer = '';
    let closers = '';
    let openedAt = -1;
    const flush = () => { tokens.push({ text: buffer, column }); buffer = ''; };
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (closers) {
        if (closers.includes(ch)) {
          if (ch === '"' && line[i + 1] === '"') { buffer += '"'; i += 1; }
          else closers = '';
        } else buffer += ch;
      } else if (ch in QUOTE_PAIRS && buffer.trim() === '' && !literalQuotes.has(i)) {
        closers = QUOTE_PAIRS[ch]!;
        openedAt = i;
        buffer = '';
      } else if (ch === '\t') {
        flush();
        column += 1;
      } else if (SEPARATORS.has(ch)) flush();
      else buffer += ch;
    }
    if (!closers) { flush(); return tokens; }
    // Re-read an unmatched opening quote as a literal, preserving later items.
    literalQuotes.add(openedAt);
  }
}

export function lastPhraseSeparatorIndex(raw: string): number {
  let last = -1;
  let closers = '';
  let valueStart = true;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (closers) {
      if (closers.includes(ch)) closers = '';
      if (ch === '\n' || ch === '\r') { closers = ''; last = i; valueStart = true; }
    } else if (SEPARATOR_CHARS.test(ch)) { last = i; valueStart = true; }
    else if (ch in QUOTE_PAIRS && valueStart) { closers = QUOTE_PAIRS[ch]!; valueStart = false; }
    else if (!/\s/.test(ch)) valueStart = false;
  }
  return last;
}

interface PhraseEntry { phrase: string; key: string; repeat: boolean; }
interface ParsedEntries { entries: PhraseEntry[]; ignoredColumns: boolean; skippedHeader: string | null; }
export interface ParsedPhraseList { phrases: string[]; duplicates: string[]; ignoredColumns: boolean; skippedHeader: string | null; }

function isSpreadsheet(rows: Token[][]): boolean {
  let multiColumnRows = 0;
  for (const row of rows) {
    const extra = row.filter((token) => token.column > 0 && token.text.trim() !== '');
    if (extra.length === 0) continue;
    multiColumnRows += 1;
    if (extra.some((token) => NUMERIC_CELL.test(token.text.trim()))) return true;
  }
  return multiColumnRows >= 2;
}

const hasNumericExtra = (row: Token[]): boolean => row.some((token) => token.column > 0 && NUMERIC_CELL.test(token.text.trim()));
const isHeaderRow = (row: Token[]): boolean => row.some((token) => token.column > 0 && token.text.trim() !== '') && !hasNumericExtra(row);

function parseEntries(raw: string): ParsedEntries {
  const rows = raw.split(/\r\n|\r|\n/).map(tokenizeLine).filter((row) => row.some((token) => cleanPhrase(token.text) !== ''));
  const spreadsheet = isSpreadsheet(rows);
  let skippedHeader: string | null = null;
  let dataRows = rows;
  if (spreadsheet && rows.length > 1 && isHeaderRow(rows[0]!) && rows.slice(1).some(hasNumericExtra)) {
    skippedHeader = cleanPhrase(rows[0]![0]!.text) || null;
    dataRows = rows.slice(1);
  }
  const pieces: string[] = [];
  let ignoredColumns = false;
  for (const row of dataRows) {
    for (const token of row) {
      const piece = cleanPhrase(token.text);
      if (spreadsheet && token.column > 0) { if (piece !== '') ignoredColumns = true; }
      else if (piece) pieces.push(piece);
    }
  }
  const numbered = pieces.filter((piece) => NUMBER_PREFIX.test(piece)).length >= 2;
  const seen = new Set<string>();
  const entries: PhraseEntry[] = [];
  for (const piece of pieces) {
    let phrase = cleanPhrase(piece.replace(BULLET_PREFIX, ''));
    if (numbered) phrase = cleanPhrase(phrase.replace(NUMBER_PREFIX, ''));
    phrase = stripWrappingQuotes(phrase);
    if (!phrase) continue;
    const key = normalizePhraseKey(phrase);
    entries.push({ phrase, key, repeat: seen.has(key) });
    seen.add(key);
  }
  return { entries, ignoredColumns, skippedHeader };
}

export function parsePhraseListDetailed(raw: string): ParsedPhraseList {
  const { entries, ignoredColumns, skippedHeader } = parseEntries(raw);
  return { phrases: entries.filter((entry) => !entry.repeat).map((entry) => entry.phrase), duplicates: entries.filter((entry) => entry.repeat).map((entry) => entry.phrase), ignoredColumns, skippedHeader };
}
export const splitPhraseList = (raw: string): string[] => parseEntries(raw).entries.map((entry) => entry.phrase);
export const parsePhraseList = (raw: string): string[] => parsePhraseListDetailed(raw).phrases;
export const formatPhraseList = (phrases: readonly string[]): string => phrases.map((phrase) => hasPhraseSeparator(phrase) || /^["“]/.test(phrase) ? `"${phrase.replace(/"/g, '""')}"` : phrase).join('\n');
export const removePhraseAt = (raw: string, index: number): string => formatPhraseList(parseEntries(raw).entries.filter((_, position) => position !== index).map((entry) => entry.phrase));

export type PhraseVerdict = 'ready' | 'repeated' | 'existing' | 'tooLong';
export interface ReviewedPhrase { phrase: string; key: string; verdict: PhraseVerdict; }
export interface ReviewPhraseListOptions { maxLength: number; maxItems: number; existingKeys?: ReadonlySet<string>; }
export interface PhraseListReview {
  items: ReviewedPhrase[];
  ready: string[];
  counts: Record<PhraseVerdict, number>;
  overPasteLimit: number;
  ignoredColumns: boolean;
  skippedHeader: string | null;
}

export function reviewPhraseList(raw: string, options: ReviewPhraseListOptions): PhraseListReview {
  const { entries, ignoredColumns, skippedHeader } = parseEntries(raw);
  const counts: Record<PhraseVerdict, number> = { ready: 0, repeated: 0, existing: 0, tooLong: 0 };
  const items: ReviewedPhrase[] = [];
  const ready: string[] = [];
  let unique = 0;
  let overPasteLimit = 0;
  for (const { phrase, key, repeat } of entries) {
    if (!repeat) {
      unique += 1;
      if (unique > options.maxItems) { overPasteLimit += 1; continue; }
    } else if (unique > options.maxItems) continue;
    const verdict: PhraseVerdict = repeat ? 'repeated' : options.existingKeys?.has(key) ? 'existing' : phrase.length > options.maxLength ? 'tooLong' : 'ready';
    counts[verdict] += 1;
    if (verdict === 'ready') ready.push(phrase);
    items.push({ phrase, key, verdict });
  }
  return { items, ready, counts, overPasteLimit, ignoredColumns, skippedHeader };
}

export interface AddPhrasesOptions { max: number; maxLength: number; }
export interface AddPhrasesResult { chips: string[]; added: string[]; duplicates: string[]; tooLong: string[]; overLimit: string[]; }

/** Per-field input bounds; duplicates remain duplicates even when the field is full. */
export function addPhrases(existing: string[], incoming: readonly string[], options: AddPhrasesOptions): AddPhrasesResult {
  const keys = new Set(existing.map(normalizePhraseKey));
  const chips = [...existing];
  const added: string[] = [];
  const duplicates: string[] = [];
  const tooLong: string[] = [];
  const overLimit: string[] = [];
  const duplicateKeys = new Set<string>();
  for (const raw of incoming) {
    const phrase = cleanPhrase(raw);
    if (!phrase) continue;
    const key = normalizePhraseKey(phrase);
    if (phrase.length > options.maxLength) tooLong.push(phrase);
    else if (keys.has(key)) {
      if (!duplicateKeys.has(key)) { duplicateKeys.add(key); duplicates.push(phrase); }
    } else if (chips.length >= options.max) overLimit.push(phrase);
    else { keys.add(key); chips.push(phrase); added.push(phrase); }
  }
  return { chips: added.length > 0 ? chips : existing, added, duplicates, tooLong, overLimit };
}
