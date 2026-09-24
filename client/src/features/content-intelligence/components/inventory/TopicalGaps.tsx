import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import type { InventoryConfidence, InventoryTopicalGap } from '../../types';

const CONFIDENCE_TONE: Record<InventoryConfidence, StatusTone> = {
  high: 'info',
  medium: 'warning',
  low: 'muted',
};

interface TopicalGapsProps {
  gaps: InventoryTopicalGap[];
}

/**
 * Topical gaps: queries competitors cover but the owned portfolio does not.
 * Each row carries its evidence count + confidence; queries are derived text
 * rendered as plain nodes.
 */
export function TopicalGaps({ gaps }: TopicalGapsProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="inventory-gaps">
      <CardHeader>
        <CardTitle>{t('inventory.findings.gaps.title')}</CardTitle>
        <CardDescription>{t('inventory.findings.gaps.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {gaps.length === 0 ? (
          <Empty data-testid="inventory-gaps-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('inventory.findings.gaps.empty')}</EmptyTitle>
              <EmptyDescription>{t('inventory.findings.gaps.emptyHint')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {gaps.map((gap) => (
              <li
                key={gap.id}
                className="border-border flex flex-wrap items-center gap-2 rounded-md border p-3"
                data-testid={`inventory-gap-${gap.id}`}
              >
                <span className="font-medium">{gap.query}</span>
                <StatusChip tone={CONFIDENCE_TONE[gap.confidence]}>
                  {t('inventory.findings.confidence', {
                    value: t(`inventory.confidence.${gap.confidence}`),
                  })}
                </StatusChip>
                <span className="text-muted-foreground text-xs">
                  {t('inventory.findings.evidence', {
                    count: gap.evidenceSourceIds.length,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
