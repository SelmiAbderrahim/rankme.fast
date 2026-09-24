import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import {
  REVIEW_THEME_EXCERPT_MAX_CHARS,
  type ReviewRequestStatus,
  type ReviewTheme,
  type ReviewThemesResponse,
} from '../types';
import type { SupportedLocale } from '@shared/i18n';
import { ReviewObservationMeta } from './ReviewObservationMeta';

interface ReviewThemeCardsProps {
  themes: ReviewThemesResponse | null;
  status: ReviewRequestStatus;
  error: string;
  /** Anchor for the "the reviews are still readable" link on AI failure. */
  inventoryHref: string;
}

const OutputLocaleChip = ({ outputLocale }: { outputLocale: SupportedLocale | null }) => {
  const { t } = useTranslation(['reviewIntelligence', 'language']);
  if (!outputLocale) return null;
  return (
    <StatusChip tone="muted" data-testid="reviews-themes-output-locale">
      {t('outputLocale', { locale: t(`language:names.${outputLocale}`) })}
    </StatusChip>
  );
};

/**
 * The server already clamps every excerpt to 300 characters at the read
 * boundary. This clamps again so a cached or replayed payload cannot render
 * longer than the contract allows.
 */
export function clampExcerpt(text: string): string {
  const glyphs = [...text];
  return glyphs.length > REVIEW_THEME_EXCERPT_MAX_CHARS
    ? glyphs.slice(0, REVIEW_THEME_EXCERPT_MAX_CHARS).join('')
    : text;
}

const ThemeSection = ({
  kind,
  themes,
}: {
  kind: 'complaint' | 'praise';
  themes: ReviewTheme[];
}) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );

  return (
    <Card data-testid={`reviews-themes-${kind}`}>
      <CardHeader>
        <CardTitle>{t(kind === 'complaint' ? 'themes.complaints' : 'themes.praise')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {themes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('themes.sectionEmpty')}</p>
        ) : (
          themes.map((theme, index) => (
            <div
              key={`${kind}-${index}`}
              className="flex flex-col gap-2 rounded-md border p-4"
              data-testid={`reviews-theme-${kind}-${index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{theme.label}</span>
                <StatusChip tone="warning">
                  {t('provenance.ai_interpretation')}
                </StatusChip>
                <StatusChip tone={kind === 'complaint' ? 'warning' : 'success'}>
                  {t('themes.citationCount', { citations: theme.citations.length })}
                </StatusChip>
              </div>
              <p className="text-muted-foreground text-sm">{theme.summary}</p>
              <Accordion type="single" collapsible>
                <AccordionItem value="citations">
                  <AccordionTrigger className="text-sm">{t('themes.citations')}</AccordionTrigger>
                  <AccordionContent>
                    <ul className="flex flex-col gap-3">
                      {theme.citations.map((citation) => (
                        <li
                          key={citation.reviewId}
                          className="flex flex-col gap-1"
                          data-testid={`reviews-citation-${citation.reviewId}`}
                        >
                          <span className="text-muted-foreground text-xs">
                            {t('themes.citationSource', {
                              source: t(`sourceNames.${citation.source}`),
                              rating:
                                citation.rating === null
                                  ? t('inventory.unrated')
                                  : String(citation.rating),
                              date: citation.reviewedAt
                                ? date.format(new Date(citation.reviewedAt))
                                : '—',
                            })}
                          </span>
                          {/* Untrusted vendor text — text node, clamped, never HTML. */}
                          <span className="text-sm">{clampExcerpt(citation.excerpt)}</span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Cited themes, or an honest terminal state.
 *
 * `no-reliable-themes` means the pass ran and nothing cleared the two-citation
 * bar; we say that, we do not invent a theme. `ai-failed-reviews-intact` means
 * the generation failed AFTER the reviews landed — the reviews stay readable,
 * so the state links back to the inventory rather than implying data loss.
 */
export const ReviewThemeCards = ({
  themes,
  status,
  error,
  inventoryHref,
}: ReviewThemeCardsProps) => {
  const { t } = useTranslation(['reviewIntelligence', 'language']);

  if (status === 'loading' && !themes) {
    return (
      <Card aria-busy="true" data-testid="reviews-themes-loading">
        <CardHeader>
          <CardTitle>{t('themes.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert role="alert" data-testid="reviews-themes-error">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!themes) return null;

  if (themes.terminal === 'pending') {
    return (
      <Card data-testid="reviews-themes-pending">
        <CardHeader>
          <CardTitle>{t('themes.title')}</CardTitle>
          <CardDescription>{t('themes.pending')}</CardDescription>
          <StatusChip tone="warning">{t('provenance.ai_interpretation')}</StatusChip>
          <OutputLocaleChip outputLocale={themes.outputLocale} />
        </CardHeader>
      </Card>
    );
  }

  if (themes.terminal === 'ai-failed-reviews-intact') {
    return (
      <Card data-testid="reviews-themes-ai-failed">
        <CardHeader>
          <CardTitle>{t('themes.aiFailed.title')}</CardTitle>
          <CardDescription>{t('themes.aiFailed.description')}</CardDescription>
          <ReviewObservationMeta observation={themes.observation} />
          {!themes.observation ? (
            <StatusChip tone="warning">{t('provenance.ai_interpretation')}</StatusChip>
          ) : null}
          <OutputLocaleChip outputLocale={themes.outputLocale} />
        </CardHeader>
        <CardContent>
          <a className="text-sm underline" href={inventoryHref} data-testid="reviews-themes-ai-failed-link">
            {t('themes.aiFailed.link')}
          </a>
        </CardContent>
      </Card>
    );
  }

  if (
    themes.terminal === 'no-reliable-themes' ||
    (themes.complaintThemes.length === 0 && themes.praiseThemes.length === 0)
  ) {
    return (
      <Card data-testid="reviews-themes-none">
        <CardHeader>
          <CardTitle>{t('themes.noReliable.title')}</CardTitle>
          <CardDescription>{t('themes.noReliable.description')}</CardDescription>
          <ReviewObservationMeta observation={themes.observation} />
          {!themes.observation ? (
            <StatusChip tone="warning">{t('provenance.ai_interpretation')}</StatusChip>
          ) : null}
          <OutputLocaleChip outputLocale={themes.outputLocale} />
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="reviews-themes">
      <OutputLocaleChip outputLocale={themes.outputLocale} />
      <ReviewObservationMeta observation={themes.observation} />
      <div className="grid gap-4 md:grid-cols-2">
        <ThemeSection kind="complaint" themes={themes.complaintThemes} />
        <ThemeSection kind="praise" themes={themes.praiseThemes} />
      </div>
    </div>
  );
};
