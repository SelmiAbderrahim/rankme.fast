import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import type { AppReviewRunDetail } from '../../reviews-types';

const sentimentClass = (sentiment: AppReviewRunDetail['clusters'][number]['sentiment']) => {
  if (sentiment === 'positive') return 'bg-success/10 text-success';
  if (sentiment === 'negative') return 'bg-destructive/10 text-destructive';
  if (sentiment === 'mixed') return 'bg-info/10 text-info';
  return 'bg-muted text-muted-foreground';
};

export function AppReviewClusters({ run }: { run: AppReviewRunDetail }) {
  const { t, i18n } = useTranslation('appSeoReviews');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );

  if (run.clusterState === 'pending') {
    return <p className="text-muted-foreground text-sm">{t('states.pending')}</p>;
  }
  if (run.clusterState === 'thin_evidence') {
    return (
      <div className="border-border bg-muted/40 rounded-xl border p-5">
        <h4 className="font-semibold">{t('states.thinTitle')}</h4>
        <p className="text-muted-foreground mt-1 text-sm">{t('states.thinDescription')}</p>
      </div>
    );
  }
  if (run.clusterState === 'unavailable') {
    return (
      <div className="border-border bg-muted/40 rounded-xl border p-5">
        <h4 className="font-semibold">{t('states.unavailableTitle')}</h4>
        <p className="text-muted-foreground mt-1 text-sm">{t('states.unavailableDescription')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {run.clusters.map((cluster, index) => (
        <Card key={`${cluster.label}-${index}`}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{cluster.label}</CardTitle>
              <Badge className={sentimentClass(cluster.sentiment)}>
                {t(`sentiment.${cluster.sentiment}`)}
              </Badge>
              <Badge variant="outline">{t('clusters.aiInterpretation')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {cluster.citations.map((citation) => (
              <blockquote
                key={citation.reviewId}
                className="border-border bg-muted/40 rounded-md border p-4"
              >
                <p className="text-sm">{citation.quote}</p>
                <footer className="text-muted-foreground mt-2 text-xs">
                  {citation.authorName ?? t('clusters.anonymous')}
                  {' · '}
                  {t('clusters.rating', { rating: citation.rating })}
                  {citation.at ? ` · ${date.format(new Date(citation.at))}` : ''}
                </footer>
              </blockquote>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

