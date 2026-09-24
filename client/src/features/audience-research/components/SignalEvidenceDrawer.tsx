import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/ui/sheet';
import { Badge } from '@shared/ui/badge';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import type { RunResultSignal, RunResultSource } from '../types';

interface SignalEvidenceDrawerProps {
  open: boolean;
  signal: RunResultSignal | null;
  sources: readonly RunResultSource[];
  onClose: () => void;
}

interface ObservationMetaShape {
  sourceKind?: string;
  sourceLabel?: string | null;
  freshness?: string;
  observedAt?: string;
}

function readObservationMeta(meta: unknown): ObservationMetaShape {
  if (typeof meta !== 'object' || meta === null) return {};
  const record = meta as Record<string, unknown>;
  const out: ObservationMetaShape = {};
  if (typeof record.sourceKind === 'string') out.sourceKind = record.sourceKind;
  if (typeof record.sourceLabel === 'string') out.sourceLabel = record.sourceLabel;
  if (typeof record.freshness === 'string') out.freshness = record.freshness;
  if (typeof record.observedAt === 'string') out.observedAt = record.observedAt;
  return out;
}

/**
 * Text-only evidence drawer. Every field is rendered as a React text node —
 * excerpt included — so untrusted vendor/AI content stays inert. External
 * links pass through `safeExternalHref` and carry `rel="nofollow ugc
 * noopener noreferrer"`.
 */
export function SignalEvidenceDrawer({
  open,
  signal,
  sources,
  onClose,
}: SignalEvidenceDrawerProps) {
  const { t } = useTranslation('audienceResearch');

  const sourceById = useMemo(() => {
    const map = new Map<string, RunResultSource>();
    for (const source of sources) map.set(source.sourceId, source);
    return map;
  }, [sources]);

  const cited = useMemo(() => {
    if (!signal) return [] as { citedId: string; source: RunResultSource | null }[];
    return signal.citedSourceIds.map((id) => ({
      citedId: id,
      source: sourceById.get(id) ?? null,
    }));
  }, [signal, sourceById]);

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-xl overflow-y-auto"
        data-testid="audience-research-evidence-drawer"
      >
        <SheetHeader>
          <SheetTitle>
            {signal ? signal.title : t('signals.evidence.title')}
          </SheetTitle>
          <SheetDescription>{t('signals.evidence.description')}</SheetDescription>
        </SheetHeader>
        {signal ? (
          <div className="flex flex-col gap-4 p-4">
            {cited.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="audience-research-evidence-empty"
              >
                {t('signals.evidence.empty')}
              </p>
            ) : null}
            <ul className="flex flex-col gap-4">
              {cited.map(({ citedId, source }) => {
                if (!source) {
                  return (
                    <li
                      key={citedId}
                      className="text-muted-foreground text-sm"
                      data-testid={`audience-research-evidence-missing-${citedId}`}
                    >
                      {t('signals.evidence.missingSource', { id: citedId })}
                    </li>
                  );
                }
                const meta = readObservationMeta(source.observationMeta);
                const observedDisplay = source.observedAt
                  ? source.observedAt.slice(0, 10)
                  : t('signals.evidence.dateUnavailable');
                const href = safeExternalHref(source.canonicalUrl);
                let host: string;
                try {
                  host = new URL(source.canonicalUrl).host;
                } catch {
                  host = '';
                }
                return (
                  <li
                    key={citedId}
                    className="border-border flex flex-col gap-2 rounded-md border p-3"
                    data-testid={`audience-research-evidence-source-${source.sourceId}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {t(`signals.sourceType.${source.sourceType}`, {
                          defaultValue: source.sourceType,
                        })}
                      </Badge>
                      {meta.sourceKind ? (
                        <Badge variant="secondary" data-testid="evidence-meta-source-kind">
                          {meta.sourceKind}
                        </Badge>
                      ) : null}
                      {meta.freshness ? (
                        <Badge variant="secondary" data-testid="evidence-meta-freshness">
                          {t('signals.evidence.freshness', {
                            value: meta.freshness,
                          })}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium">{source.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {t('signals.evidence.observedAt', { date: observedDisplay })}
                    </p>
                    <p
                      className="text-sm"
                      data-testid={`evidence-excerpt-${source.sourceId}`}
                    >
                      {source.excerpt}
                    </p>
                    <p className="text-xs">
                      {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains "noreferrer noopener" */}
                      <a
                        href={href}
                        rel={SAFE_EXTERNAL_REL}
                        target="_blank"
                        data-testid={`evidence-link-${source.sourceId}`}
                        aria-label={t('signals.evidence.openLinkAria', {
                          host: host || source.canonicalUrl,
                        })}
                      >
                        {host || t('signals.evidence.openLink')}
                      </a>
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
