import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import type { InventoryCannibalizationCandidate, InventoryConfidence } from '../../types';

const CONFIDENCE_TONE: Record<InventoryConfidence, StatusTone> = {
  high: 'info',
  medium: 'warning',
  low: 'muted',
};

interface CannibalizationListProps {
  candidates: InventoryCannibalizationCandidate[];
  /** Deep-link into a NEW analysis prefilled with this query + owned URL. */
  onStartAnalysis: (query: string, url: string) => void;
}

/**
 * Cannibalization candidates: two or more owned pages competing for one query.
 * Shows evidence count + confidence and offers a deep link into a prefilled new
 * analysis. It NEVER auto-creates an analysis — the user confirms on the form.
 */
export function CannibalizationList({
  candidates,
  onStartAnalysis,
}: CannibalizationListProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="inventory-cannibalization">
      <CardHeader>
        <CardTitle>{t('inventory.findings.cannibalization.title')}</CardTitle>
        <CardDescription>
          {t('inventory.findings.cannibalization.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <Empty data-testid="inventory-cannibalization-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('inventory.findings.cannibalization.empty')}</EmptyTitle>
              <EmptyDescription>
                {t('inventory.findings.cannibalization.emptyHint')}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="border-border flex flex-col gap-2 rounded-md border p-3"
                data-testid={`inventory-cannibalization-${candidate.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{candidate.query}</span>
                  <StatusChip tone={CONFIDENCE_TONE[candidate.confidence]}>
                    {t('inventory.findings.confidence', {
                      value: t(`inventory.confidence.${candidate.confidence}`),
                    })}
                  </StatusChip>
                  {candidate.hasGscEvidence ? (
                    <StatusChip tone="success" data-testid="inventory-cannibalization-gsc">
                      {t('inventory.findings.cannibalization.hasGsc')}
                    </StatusChip>
                  ) : (
                    <StatusChip tone="muted" data-testid="inventory-cannibalization-nogsc">
                      {t('inventory.findings.cannibalization.noGsc')}
                    </StatusChip>
                  )}
                </div>
                <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
                  {candidate.urls.map((url) => (
                    <li key={`${candidate.id}-${url}`}>{url}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">
                  {t('inventory.findings.evidence', {
                    count: candidate.evidenceSourceIds.length,
                  })}
                </p>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onStartAnalysis(candidate.query, candidate.urls[0] ?? '')
                    }
                    data-testid={`inventory-cannibalization-start-${candidate.id}`}
                  >
                    {t('inventory.findings.cannibalization.startAnalysis')}
                    <ArrowRight aria-hidden="true" className="ms-2 size-4 rtl:rotate-180" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
