import { ArrowDown, ArrowUp, CircleAlert, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PositionDelta } from '@shared/components/PositionDelta';
import { cn } from '@shared/lib/utils';
import type { Keyword, KeywordRankState } from '../types';

const TONE: Record<KeywordRankState, string> = {
  ranked: 'text-muted-foreground', improved: 'text-success', declined: 'text-destructive',
  unchanged: 'text-muted-foreground', new: 'text-success', lost: 'text-destructive',
  not_in_top_100: 'text-muted-foreground', failed_last_check: 'text-destructive',
  never_checked: 'text-muted-foreground',
};
const ICON: Partial<Record<KeywordRankState, typeof ArrowUp>> = {
  new: ArrowUp, lost: ArrowDown, not_in_top_100: Minus, failed_last_check: CircleAlert,
};

/** Render the server's stored rank classification with words and shape. */
export function RankStateLabel({ keyword }: { keyword: Keyword }) {
  const { t } = useTranslation('ranks');
  const state = keyword.rankState?.state;
  if (state === undefined || state === 'improved' || state === 'declined' || state === 'unchanged') {
    return <span data-rank-state={state} className="inline-flex">
      <PositionDelta change={keyword.positionChange} movement={keyword.movement} fallbackDelta={keyword.delta} />
    </span>;
  }
  const Icon = ICON[state];
  return <span className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', TONE[state])}
    data-rank-state={state} data-testid={`keyword-rank-state-${keyword.id}`}>
    {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
    {t(`rankState.${state}`)}
  </span>;
}
