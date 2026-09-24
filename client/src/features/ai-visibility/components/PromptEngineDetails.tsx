import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { safeExternalHref } from '@shared/security';
import { StatusChip } from '@shared/ui/status-chip';
import type { AiVisibilitySnapshot } from '../types';

interface Props {
  /** Latest snapshot per engine for ONE prompt, newest first. */
  snapshots: AiVisibilitySnapshot[];
}

/**
 * Vendor model strings → human labels. The raw string falls through so an
 * unknown engine renders honestly instead of disappearing.
 */
export const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  chat_gpt: 'ChatGPT',
  perplexity: 'Perplexity',
  claude: 'Claude',
  gemini: 'Gemini',
  google: 'Google AI',
  'google-ai-mode': 'Google AI',
};

export const modelLabel = (model: string): string =>
  MODEL_LABELS[model.trim().toLowerCase()] ?? model;

/** Per-engine breakdown rendered inside a prompt row's expanded region. */
export const PromptEngineDetails = ({ snapshots }: Props) => {
  const { t, i18n } = useTranslation('aiVisibility');
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <ul className="flex flex-col gap-2" data-testid="ai-visibility-engine-details">
      {snapshots.map((row) => (
        <li
          key={`${row.model}-${row.checkedAt}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          <span className="w-24 font-medium">{modelLabel(row.model)}</span>
          <StatusChip tone={row.mentioned ? 'success' : 'muted'}>
            {row.mentioned ? t('prompts.mentioned') : t('prompts.notMentioned')}
          </StatusChip>
          {row.citedUrl ? (
            <a
              href={safeExternalHref(row.citedUrl)}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              className="inline-flex max-w-64 items-center gap-1 truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              data-testid="ai-visibility-cited-url"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate" dir="ltr">
                {row.citedUrl}
              </span>
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">{t('details.noCitation')}</span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
            {dateFormat.format(new Date(row.checkedAt))}
          </span>
        </li>
      ))}
    </ul>
  );
};
