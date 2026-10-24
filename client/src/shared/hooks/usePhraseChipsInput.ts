import { useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent, type CompositionEvent, type KeyboardEvent } from 'react';
import { addPhrases, cleanPhrase, formatPhraseList, hasPhraseSeparator, lastPhraseSeparatorIndex, splitPhraseList } from '@shared/lib/phraseList';

export interface PhraseChipsNotice {
  duplicates: string[];
  tooLong: string[];
  limitHit: boolean;
  rejected: Array<{ phrase: string; reason: string }>;
}
const NO_NOTICE: PhraseChipsNotice = { duplicates: [], tooLong: [], limitHit: false, rejected: [] };
export type PhraseNormalization = { value: string } | { rejected: string };
interface Options {
  chips: string[];
  onChange: (chips: string[]) => void;
  max: number;
  maxLength: number;
  normalizePhrase?: (phrase: string) => PhraseNormalization;
}

/** Commit completed phrases while preserving unfinished or refused input. */
export function usePhraseChipsInput({ chips, onChange, max, maxLength, normalizePhrase }: Options) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<PhraseChipsNotice>(NO_NOTICE);
  const composing = useRef(false);
  const clearNotice = useCallback(() => setNotice(NO_NOTICE), []);

  const commit = (raw: string): string => {
    const pieces = splitPhraseList(raw);
    if (pieces.length === 0) { clearNotice(); return ''; }
    const rejected: PhraseChipsNotice['rejected'] = [];
    const phrases: string[] = [];
    const pending: Array<{ phrase: string; rejected: boolean }> = [];
    for (const piece of pieces) {
      const normalized = normalizePhrase ? normalizePhrase(piece) : { value: piece };
      if ('rejected' in normalized) {
        rejected.push({ phrase: piece, reason: normalized.rejected });
        pending.push({ phrase: piece, rejected: true });
      } else {
        phrases.push(normalized.value);
        pending.push({ phrase: cleanPhrase(normalized.value), rejected: false });
      }
    }
    const result = addPhrases(chips, phrases, { max, maxLength });
    if (result.added.length > 0) onChange(result.chips);
    setNotice({ duplicates: result.duplicates, tooLong: result.tooLong, limitHit: result.overLimit.length > 0, rejected });
    if (result.added.length === 0 && result.duplicates.length === 0) {
      if (!/[\r\n]/.test(raw)) return raw;
      // Preserve the parser's boundaries when unmatched quotes cross a newline.
      return pieces.map((phrase) => formatPhraseList([phrase])).join('; ');
    }
    // Inputs strip newlines; quote each refused phrase, retaining input order.
    const refused = new Set([...result.tooLong, ...result.overLimit]);
    return pending.filter((piece) => piece.rejected || refused.has(piece.phrase))
      .map(({ phrase }) => formatPhraseList([phrase])).join('; ');
  };

  const handleChange = (value: string): void => {
    clearNotice();
    if (composing.current) { setDraft(value); return; }
    const cut = lastPhraseSeparatorIndex(value);
    if (cut < 0) {
      setDraft(value);
    } else {
      const refused = commit(value.slice(0, cut));
      const tail = value.slice(cut + 1).trimStart();
      setDraft([refused, tail].filter(Boolean).join('; '));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData.getData('text');
    if (!hasPhraseSeparator(text)) return;
    event.preventDefault();
    const input = event.currentTarget;
    setDraft(commit(`${draft.slice(0, input.selectionStart ?? 0)}${text}${draft.slice(input.selectionEnd ?? draft.length)}`));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const quotedComma = event.key === ',' && lastPhraseSeparatorIndex(`${draft},`) !== draft.length;
    if (event.key === 'Enter' || (event.key === ',' && !quotedComma)) {
      event.preventDefault();
      setDraft(commit(draft));
    } else if (event.key === 'Backspace' && draft === '' && chips.length > 0) {
      onChange(chips.slice(0, -1));
      clearNotice();
    }
  };

  return {
    draft, setDraft, notice, clearNotice,
    inputProps: {
      value: draft,
      onChange: (event: ChangeEvent<HTMLInputElement>) => handleChange(event.target.value),
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      onBlur: () => { composing.current = false; setDraft(commit(draft)); },
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => { composing.current = false; handleChange(event.currentTarget.value); },
    },
  };
}
