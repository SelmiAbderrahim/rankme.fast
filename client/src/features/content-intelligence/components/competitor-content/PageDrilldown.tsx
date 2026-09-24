import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { StatusChip } from '@shared/ui/status-chip';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import type { CompetitorContentRunPage } from '../../types';

interface PageDrilldownProps {
  pages: CompetitorContentRunPage[];
}

/**
 * Per-page derived facts for the owned page and every scraped competitor page.
 * Competitor snippets are UNTRUSTED prose — rendered as React text nodes only.
 * Source URLs go through `safeExternalHref` + `rel="nofollow ugc noopener
 * noreferrer"` so a crawled URL can never become an unsafe or trust-passing
 * link.
 */
export function PageDrilldown({ pages }: PageDrilldownProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="competitor-drilldown">
      <CardHeader>
        <CardTitle>{t('competitorContent.drilldown.title')}</CardTitle>
        <CardDescription>{t('competitorContent.drilldown.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {pages.length === 0 ? (
          <Empty data-testid="competitor-drilldown-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('competitorContent.drilldown.empty')}</EmptyTitle>
              <EmptyDescription>{t('competitorContent.drilldown.emptyHint')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {pages.map((p) => (
              <li
                key={p.url}
                className="border-border flex flex-col gap-3 rounded-md border p-4"
                data-testid={`competitor-page-${p.url}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={p.role === 'owned' ? 'primary' : 'info'}>
                    {t(`competitorContent.drilldown.role.${p.role}`)}
                  </StatusChip>
                  {p.facts.competitorDomain ? (
                    <span className="text-muted-foreground text-sm">
                      {p.facts.competitorDomain}
                    </span>
                  ) : null}
                </div>

                {p.facts.title ? (
                  <p className="font-medium">{p.facts.title}</p>
                ) : null}

                {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains "noopener noreferrer" */}
                <a
                  href={safeExternalHref(p.url)}
                  target="_blank"
                  rel={SAFE_EXTERNAL_REL}
                  className="text-primary inline-flex w-fit items-center gap-1 text-sm hover:underline"
                  data-testid={`competitor-page-link-${p.url}`}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {t('competitorContent.drilldown.visit')}
                </a>

                <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                  <div className="flex flex-col">
                    <dt className="text-muted-foreground text-xs">
                      {t('competitorContent.drilldown.words')}
                    </dt>
                    <dd className="tabular-nums">{p.facts.wordCount}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-muted-foreground text-xs">
                      {t('competitorContent.drilldown.headings')}
                    </dt>
                    <dd className="tabular-nums">{p.facts.headings.length}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-muted-foreground text-xs">
                      {t('competitorContent.drilldown.internalLinks')}
                    </dt>
                    <dd className="tabular-nums">{p.facts.internalLinkCount}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-muted-foreground text-xs">
                      {t('competitorContent.drilldown.externalLinks')}
                    </dt>
                    <dd className="tabular-nums">{p.facts.externalLinkCount}</dd>
                  </div>
                </dl>

                {p.facts.primaryTopics.length > 0 ? (
                  <div className="flex flex-wrap gap-1" data-testid={`competitor-page-topics-${p.url}`}>
                    {p.facts.primaryTopics.map((topic) => (
                      <Badge key={`${p.url}-${topic}`} variant="secondary" className="font-normal">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {p.facts.snippet ? (
                  <blockquote
                    className="text-muted-foreground border-border border-s-2 ps-3 text-sm"
                    data-testid={`competitor-page-snippet-${p.url}`}
                  >
                    {p.facts.snippet}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
