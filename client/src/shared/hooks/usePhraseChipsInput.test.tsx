import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePhraseChipsInput, type PhraseNormalization } from './usePhraseChipsInput';
import { parsePhraseList } from '@shared/lib/phraseList';

function Field({ max = 3, maxLength = 20, normalizePhrase, inputType = 'text' }: { max?: number; maxLength?: number; normalizePhrase?: (phrase: string) => PhraseNormalization; inputType?: 'text' | 'email' }) {
  const [chips, setChips] = useState<string[]>([]);
  const { inputProps, notice, clearNotice } = usePhraseChipsInput({ chips, onChange: setChips, max, maxLength, normalizePhrase });
  return <><input type={inputType} aria-label="Phrases" {...inputProps} /><output data-testid="state">{JSON.stringify({ chips, notice })}</output><button onClick={clearNotice}>Clear notice</button></>;
}
const input = () => screen.getByRole('textbox', { name: 'Phrases' });
const enter = (value: string) => { fireEvent.change(input(), { target: { value } }); fireEvent.keyDown(input(), { key: 'Enter' }); };
const state = () => JSON.parse(screen.getByTestId('state').textContent!);

describe('phrase chip input', () => {
  it('preserves unmatched quote identities across refused multiline paste', () => {
    render(<Field maxLength={1} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => '"long\nphrase"' } });
    expect(state().chips).toEqual([]);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['"long', 'phrase"']);
    fireEvent.blur(input());
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['"long', 'phrase"']);
    expect(state().notice.tooLong).toEqual(['"long', 'phrase"']);
  });

  it('preserves input order across different refusal reasons and an unfinished tail', () => {
    render(<Field max={1} maxLength={4} normalizePhrase={(phrase) => phrase === 'bad' ? { rejected: 'invalid' } : { value: phrase }} />);
    fireEvent.change(input(), { target: { value: 'bad; toolong; yes; next; tail' } });
    expect(state().chips).toEqual(['yes']);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['bad', 'toolong', 'next', 'tail']);
    expect(state().notice.rejected).toEqual([{ phrase: 'bad', reason: 'invalid' }]);
    expect(state().notice.tooLong).toEqual(['toolong']);
    expect(state().notice.limitHit).toBe(true);
  });

  it('keeps wholly refused multiline pastes reparsable in a single-line textbox', () => {
    render(<Field maxLength={4} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => '"one, two"\n"three; four"' } });
    expect(state().chips).toEqual([]);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['one, two', 'three; four']);
    fireEvent.blur(input());
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['one, two', 'three; four']);
    expect(state().notice.tooLong).toEqual(['one, two', 'three; four']);
  });

  it.each(['change', 'composition'] as const)('retains separator-triggered refused input and the unfinished tail on %s', (trigger) => {
    render(<Field maxLength={4} normalizePhrase={(phrase) => phrase === 'bad' ? { rejected: 'invalid' } : { value: phrase }} />);
    if (trigger === 'composition') fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: 'yes；toolong；bad；tail' } });
    if (trigger === 'composition') {
      expect(state().chips).toEqual([]);
      expect(input()).toHaveValue('yes；toolong；bad；tail');
      fireEvent.compositionEnd(input());
    }
    expect(state().chips).toEqual(['yes']);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['toolong', 'bad', 'tail']);
    expect(state().notice.tooLong).toEqual(['toolong']);
    expect(state().notice.rejected).toEqual([{ phrase: 'bad', reason: 'invalid' }]);
  });

  it.each(['change', 'composition'] as const)('keeps quoted refused phrases reparsable in the actual textbox on %s', (trigger) => {
    render(<Field maxLength={4} />);
    if (trigger === 'composition') fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: 'yes; "best crm, free"; "quote; inside"; tail' } });
    if (trigger === 'composition') fireEvent.compositionEnd(input());
    expect(state().chips).toEqual(['yes']);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['best crm, free', 'quote; inside', 'tail']);
    fireEvent.blur(input());
    expect(state().chips).toEqual(['yes', 'tail']);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['best crm, free', 'quote; inside']);
  });

  it.each([
    ['change', 'long'], ['composition', 'long'],
    ['change', 'rejected'], ['composition', 'rejected'],
    ['change', 'full'], ['composition', 'full'],
  ] as const)('retains wholly refused separator input on %s when %s', (trigger, refusal) => {
    render(<Field max={1} maxLength={4} normalizePhrase={(phrase) => phrase === 'bad' ? { rejected: 'invalid' } : { value: phrase }} />);
    if (refusal === 'full') enter('one');
    const refused = refusal === 'long' ? 'toolong' : refusal === 'rejected' ? 'bad' : 'two';
    if (trigger === 'composition') fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: `${refused}；` } });
    if (trigger === 'composition') fireEvent.compositionEnd(input());
    expect(input()).toHaveValue(refused);
    expect(state().chips).toEqual(refusal === 'full' ? ['one'] : []);
    if (refusal === 'long') expect(state().notice.tooLong).toEqual(['toolong']);
    if (refusal === 'rejected') expect(state().notice.rejected).toEqual([{ phrase: 'bad', reason: 'invalid' }]);
    if (refusal === 'full') expect(state().notice.limitHit).toBe(true);
  });

  it('retains phrases refused by a full field alongside the unfinished tail', () => {
    render(<Field max={1} />);
    fireEvent.change(input(), { target: { value: 'one; two; three; tail' } });
    expect(state().chips).toEqual(['one']);
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['two', 'three', 'tail']);
    expect(state().notice.limitHit).toBe(true);
  });

  it.each(['edit', 'delete', 'composition'] as const)('clears a stale full-field notice on %s and empty blur', (edit) => {
    render(<Field max={1} />);
    enter('one');
    enter('two');
    expect(state().notice.limitHit).toBe(true);
    if (edit === 'composition') fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: edit === 'edit' ? 'three' : '' } });
    expect(state().notice.limitHit).toBe(false);
    if (edit === 'composition') fireEvent.compositionEnd(input());
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(state().notice.limitHit).toBe(false);
    expect(input()).toHaveValue('');
    expect(state().chips).toEqual(['one']);
  });

  it('commits completed phrases and keeps the unfinished tail editable', () => {
    render(<Field />);
    enter('one');
    fireEvent.change(input(), { target: { value: 'two, tail' } });
    expect(state().chips).toEqual(['one', 'two']);
    expect(input()).toHaveValue('tail');
    fireEvent.keyDown(input(), { key: ',' });
    expect(state().chips).toEqual(['one', 'two', 'tail']);
    fireEvent.blur(input());
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(state().chips).toEqual(['one', 'two']);
    fireEvent.change(input(), { target: { value: 'keep' } });
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(state().chips).toEqual(['one', 'two']);
    expect(input()).toHaveValue('keep');
  });

  it('keeps quoted commas intact and reports duplicates until the draft changes', () => {
    render(<Field />);
    fireEvent.change(input(), { target: { value: '"one' } });
    expect(fireEvent.keyDown(input(), { key: ',' })).toBe(true);
    enter('"one, two"');
    enter('"ONE, TWO"');
    expect(state().chips).toEqual(['one, two']);
    expect(state().notice.duplicates).toEqual(['ONE, TWO']);
    fireEvent.change(input(), { target: { value: 'next' } });
    expect(state().notice.duplicates).toEqual([]);
  });

  it('splices pasted lists at the selection and leaves ordinary pastes to the browser', () => {
    render(<Field />);
    fireEvent.change(input(), { target: { value: 'old words' } });
    (input() as HTMLInputElement).setSelectionRange(0, 3);
    expect(fireEvent.paste(input(), { clipboardData: { getData: () => 'new, other' } })).toBe(false);
    expect(state().chips).toEqual(['new', 'other words']);
    expect(fireEvent.paste(input(), { clipboardData: { getData: () => 'plain' } })).toBe(true);
  });

  it('supports input types that do not expose a text selection', () => {
    render(<Field inputType="email" />);
    fireEvent.change(input(), { target: { value: 'old@example.test' } });
    expect((input() as HTMLInputElement).selectionStart).toBeNull();
    fireEvent.paste(input(), { clipboardData: { getData: () => 'new@example.test, second@example.test' } });
    expect(state().chips).toEqual(['new@example.test', 'second@example.test']);
  });

  it('retains overlong phrases from mixed input so they can be corrected', () => {
    render(<Field maxLength={4} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => 'yes, toolong' } });
    expect(state().chips).toEqual(['yes']);
    expect(state().notice.tooLong).toEqual(['toolong']);
    expect(input()).toHaveValue('toolong');
    fireEvent.blur(input());
    expect(input()).toHaveValue('toolong');
    enter('good');
    expect(state().chips).toEqual(['yes', 'good']);
  });

  it('keeps refused input editable and reports per-field bounds separately from duplicates', () => {
    render(<Field max={1} />);
    enter('a');
    enter('b');
    expect(input()).toHaveValue('b');
    expect(state().notice.limitHit).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear notice' }));
    expect(state().notice.limitHit).toBe(false);
    enter('A');
    expect(state().notice.duplicates).toEqual(['A']);
    expect(input()).toHaveValue('');
  });

  it('normalizes accepted input and retains a wholly rejected paste for editing', () => {
    render(<Field normalizePhrase={(phrase) => phrase === 'bad' ? { rejected: 'invalid' } : { value: phrase.toLowerCase() }} />);
    enter('OK');
    expect(state().chips).toEqual(['ok']);
    enter('bad');
    expect(state().notice.rejected).toEqual([{ phrase: 'bad', reason: 'invalid' }]);
    expect(input()).toHaveValue('bad');
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.paste(input(), { clipboardData: { getData: () => 'bad, bad' } });
    expect(input()).toHaveValue('bad, bad');
    fireEvent.change(input(), { target: { value: 'bad, GOOD' } });
    expect(parsePhraseList((input() as HTMLInputElement).value)).toEqual(['bad', 'GOOD']);
    // The user removes the refused phrase before committing the corrected tail.
    fireEvent.change(input(), { target: { value: 'GOOD' } });
    expect(input()).toHaveValue('GOOD');
    fireEvent.blur(input());
    expect(state().chips).toEqual(['ok', 'good']);
  });

  it('does not commit or split text while an input method is composing', () => {
    render(<Field />);
    fireEvent.change(input(), { target: { value: 'pending' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(state().chips).toEqual([]);
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: '日本語、入力' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(state().chips).toEqual([]);
    fireEvent.compositionEnd(input());
    expect(state().chips).toEqual(['日本語']);
    expect(input()).toHaveValue('入力');
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(state().chips).toEqual(['日本語']);
    fireEvent.blur(input());
    expect(state().chips).toEqual(['日本語', '入力']);
  });
});
