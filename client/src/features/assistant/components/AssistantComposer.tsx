import type { FormEvent, KeyboardEvent, Ref } from 'react';
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
  /** Lets the page focus the box, e.g. after a suggestion fills it. */
  textareaRef?: Ref<HTMLTextAreaElement>;
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
  textareaRef,
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
    <form
      className="shrink-0 border-t bg-card max-lg:sticky max-lg:bottom-0 max-lg:z-10"
      onSubmit={handleSubmit}
    >
      {/* Same column as the message log, so the box lines up with the replies. */}
      <div className="mx-auto w-full max-w-5xl px-4 py-3 md:px-6">
        <Label htmlFor="assistant-message" className="sr-only">
          {t('composer.label')}
        </Label>
        <div className="flex min-w-0 items-end gap-2">
          <Textarea
            ref={textareaRef}
            id="assistant-message"
            value={draft}
            maxLength={ASSISTANT_MESSAGE_MAX_CHARS}
            rows={2}
            className="min-h-14 resize-none sm:min-h-16"
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
          <p id="assistant-composer-help" className="max-sm:sr-only">{t('composer.hint')}</p>
          <p id="assistant-character-count">
            {t('composer.characters', {
              count: draft.length,
              max: ASSISTANT_MESSAGE_MAX_CHARS,
            })}
          </p>
        </div>
      </div>
    </form>
  );
}
