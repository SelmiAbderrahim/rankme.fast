/**
 * Small chips input shared by the gap/overview/trends/clusters forms.
 *
 * Commits a chip on Enter or comma; Backspace on an empty input removes the
 * last chip; every chip has a labelled remove button (keyboard parity). The
 * bound `max` is the caller's server-mirrored ceiling — the input refuses
 * additions past it with a visible localized message rather than silently
 * dropping input.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { keywordSlug } from './KeywordResearchPanel';

interface PhraseChipsInputProps {
  id: string;
  label: string;
  placeholder: string;
  chips: string[];
  onChange: (chips: string[]) => void;
  max: number;
  maxLength?: number;
  testIdPrefix: string;
}

export const PhraseChipsInput = ({
  id,
  label,
  placeholder,
  chips,
  onChange,
  max,
  maxLength = 80,
  testIdPrefix,
}: PhraseChipsInputProps) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [limitHit, setLimitHit] = useState(false);

  const commit = () => {
    const phrase = draft.trim();
    if (!phrase) return;
    if (chips.length >= max) {
      setLimitHit(true);
      return;
    }
    if (!chips.includes(phrase)) onChange([...chips, phrase]);
    setDraft('');
    setLimitHit(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
      onChange(chips.slice(0, -1));
      setLimitHit(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((chip, idx) => (
            <li
              key={chip}
              className="border-border bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
              data-testid={`${testIdPrefix}-chip-${keywordSlug(chip)}`}
            >
              <span className="max-w-48 truncate">{chip}</span>
              <button
                type="button"
                aria-label={t('keywordResearch:removeKeyword', { phrase: chip })}
                onClick={() => {
                  onChange(chips.filter((_, i) => i !== idx));
                  setLimitHit(false);
                }}
                className="cursor-pointer"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        data-testid={`${testIdPrefix}-input`}
      />
      <p className="text-muted-foreground text-xs" data-testid={`${testIdPrefix}-count`}>
        {t('keywordResearch:selectionCount', { count: chips.length, max })}
      </p>
      {limitHit ? (
        <p
          role="alert"
          className="text-destructive text-xs"
          data-testid={`${testIdPrefix}-limit`}
        >
          {t('keywordResearch:tracked.limitReached', { max })}
        </p>
      ) : null}
    </div>
  );
};
