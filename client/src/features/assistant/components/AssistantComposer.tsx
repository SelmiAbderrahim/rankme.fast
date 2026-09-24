import type { FormEvent, KeyboardEvent } from 'react';
import { SendHorizontal, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';

export const ASSISTANT_MESSAGE_MAX_CHARS = 8_000;

interface AssistantComposerProps {
  draft: string;
  disabled?: boolean;
  creating?: boolean;
  streaming?: boolean;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

/** Keyboard-parity composer: Enter sends, Shift+Enter inserts a newline. */
export function AssistantComposer({
  draft,
  disabled = false,
  creating = false,
  streaming = false,
  onDraftChange,
  onSend,
  onStop,
}: AssistantComposerProps) {
  const { t } = useTranslation('assistant');
  const canSend = !disabled && !creating && !streaming && draft.trim().length > 0;

  const submit = () => {
    if (canSend) onSend(draft.trim());
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="border-t bg-card p-4" onSubmit={handleSubmit}>
      <Label htmlFor="assistant-message" className="sr-only">
        {t('composer.label')}
      </Label>
      <div className="flex items-end gap-2">
        <Textarea
          id="assistant-message"
          value={draft}
          maxLength={ASSISTANT_MESSAGE_MAX_CHARS}
          rows={3}
          className="min-h-20 resize-none"
          placeholder={t('composer.placeholder')}
          disabled={disabled || creating || streaming}
          aria-describedby="assistant-composer-help assistant-character-count"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {streaming ? (
          <Button type="button" variant="outline" onClick={onStop}>
            <Square aria-hidden="true" />
            {t('composer.stop')}
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={!canSend}
            loading={creating}
            loadingLabel={<span className="sr-only">{t('composer.sending')}</span>}
            aria-label={creating ? t('composer.sending') : t('composer.send')}
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <p id="assistant-composer-help">{t('composer.hint')}</p>
        <p id="assistant-character-count">
          {t('composer.characters', {
            count: draft.length,
            max: ASSISTANT_MESSAGE_MAX_CHARS,
          })}
        </p>
      </div>
    </form>
  );
}
