import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, X } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { isolateText } from '@shared/lib/bidi';
import { writeToClipboard } from '@shared/lib/clipboard';
import { cn } from '@shared/lib/utils';
import { formatPhraseList, type PhraseListReview, type PhraseVerdict, type ReviewedPhrase } from '@shared/lib/phraseList';
import { Bdi } from './Bdi';

export const PHRASE_PREVIEW_RENDER_LIMIT = 100;
const VERDICT_CLASS: Record<PhraseVerdict, string> = {
  ready: 'border-input bg-background',
  repeated: 'border-border bg-muted text-muted-foreground',
  existing: 'border-border bg-muted text-muted-foreground',
  tooLong: 'border-destructive bg-destructive/10 text-destructive',
};
export interface PhraseListPreviewProps {
  review: PhraseListReview;
  countLabel: string;
  maxItems: number;
  onRemove: (item: ReviewedPhrase, index: number) => void;
  verdictLabels?: Partial<Record<PhraseVerdict, string>>;
  testIdPrefix: string;
  countId: string;
}

/** Bounded preview with explicit rejection reasons and editable source items. */
export function PhraseListPreview({ review, countLabel, maxItems, onRemove, verdictLabels, testIdPrefix, countId }: PhraseListPreviewProps) {
  const { t } = useTranslation('common');
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const shown = review.items.slice(0, PHRASE_PREVIEW_RENDER_LIMIT);
  const hidden = review.items.length - shown.length;
  const verdictLabel = (verdict: PhraseVerdict) => verdictLabels?.[verdict] ?? t(`phraseList.verdict.${verdict}`);
  const copy = async () => {
    setCopyState('copying');
    const unique = review.items.filter((item) => item.verdict !== 'repeated').map((item) => item.phrase);
    setCopyState(await writeToClipboard(formatPhraseList(unique)) ? 'copied' : 'failed');
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`${testIdPrefix}-preview`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={countId} className="text-sm font-medium" aria-live="polite" data-testid={`${testIdPrefix}-count`}>{countLabel}</p>
        {review.items.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" loading={copyState === 'copying'} onClick={() => void copy()} data-testid={`${testIdPrefix}-copy`}>
            <Copy aria-hidden="true" />{t('phraseList.copy')}
          </Button>
        ) : null}
      </div>
      {copyState === 'copied' || copyState === 'failed' ? <p className="text-muted-foreground text-xs" role="status">{t(copyState === 'copied' ? 'phraseList.copied' : 'phraseList.copyFailed')}</p> : null}
      {review.ignoredColumns ? <p className="text-muted-foreground text-sm" data-testid={`${testIdPrefix}-columns`}>{t('phraseList.ignoredColumns')}</p> : null}
      {review.skippedHeader ? <p className="text-muted-foreground text-sm" data-testid={`${testIdPrefix}-header`}>{t('phraseList.skippedHeader', { header: review.skippedHeader })}</p> : null}
      {review.overPasteLimit > 0 ? <p className="text-warning text-sm" data-testid={`${testIdPrefix}-paste-limit`}>{t('phraseList.overPasteLimit', { count: review.overPasteLimit, max: maxItems })}</p> : null}
      {shown.length > 0 ? (
        <ul className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto" aria-label={t('phraseList.listLabel')} data-testid={`${testIdPrefix}-items`}>
          {shown.map((item, index) => (
            <li key={`${item.key}-${index}`} className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs', VERDICT_CLASS[item.verdict])} data-testid={`${testIdPrefix}-item`} data-verdict={item.verdict} title={isolateText(item.phrase)}>
              <Bdi className="block max-w-56 truncate">{item.phrase}</Bdi>
              {item.verdict !== 'ready' ? <span className="shrink-0 font-medium">· {verdictLabel(item.verdict)}</span> : null}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('phraseList.remove', { phrase: isolateText(item.phrase) })} onClick={() => onRemove(item, index)}><X className="size-3" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? <p className="text-muted-foreground text-xs" data-testid={`${testIdPrefix}-more`}>{t('phraseList.more', { count: hidden })}</p> : null}
    </div>
  );
}
