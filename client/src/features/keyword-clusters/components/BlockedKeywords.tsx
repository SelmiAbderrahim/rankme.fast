import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@shared/ui/accordion';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import type { KeywordClusterBlocked } from '../types';

interface BlockedKeywordsProps {
  blocked: readonly KeywordClusterBlocked[];
  total: number;
  ranksHref?: string;
}

/**
 * Blocked keywords are always named with their reason — the surface never
 * silently drops a tracked keyword from a run.
 */
export const BlockedKeywords = ({ blocked, total, ranksHref }: BlockedKeywordsProps) => {
  const { t } = useTranslation('keywordClusters');
  if (blocked.length === 0) return null;

  return (
    <Accordion type="single" collapsible data-testid="keyword-clusters-blocked">
      <AccordionItem value="blocked">
        <AccordionTrigger>{t('blocked.title', { count: total })}</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <p className="text-muted-foreground text-sm">{t('blocked.body')}</p>
          <ul className="space-y-2">
            {blocked.map((row) => (
              <li
                key={row.keywordId}
                className="border-border flex flex-wrap items-center gap-2 border p-2"
                data-testid={`keyword-clusters-blocked-${row.reason}`}
              >
                <span className="text-sm font-medium">{row.phrase}</span>
                <Badge variant="outline">{t(`blocked.reason.${row.reason}`)}</Badge>
                {row.observedAt ? (
                  <span className="text-muted-foreground text-xs">
                    {t('blocked.observedAt', { date: row.observedAt })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {total > blocked.length ? (
            <p className="text-muted-foreground text-sm">
              {t('blocked.more', { count: total - blocked.length })}
            </p>
          ) : null}
          {ranksHref ? (
            <Button asChild size="sm" variant="outline">
              <Link to={ranksHref}>{t('states.ranksCta')}</Link>
            </Button>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
