import { ArrowRight, Check, Clipboard, FileText, Network } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@shared/ui/accordion';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Separator } from '@shared/ui/separator';
import { CodeFixPromptButton } from '@shared/components/CodeFixPromptButton';
import type { InternalLinkSuggestion } from '../types';

interface SuggestionListProps {
  suggestions: InternalLinkSuggestion[];
}

export const SuggestionList = ({ suggestions }: SuggestionListProps) => {
  const { t, i18n } = useTranslation('internalLinks');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (suggestion: InternalLinkSuggestion) => {
    try {
      await navigator.clipboard.writeText(suggestion.anchorText);
      setCopiedId(suggestion.id);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="internal-links-suggestions">
      {suggestions.map((suggestion) => (
        <Card key={suggestion.id} data-testid={`internal-links-suggestion-${suggestion.id}`}>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(`flags.${suggestion.targetFlag}`)}</Badge>
              <Badge variant="secondary">{t(`confidence.${suggestion.confidence}`)}</Badge>
              {suggestion.rank !== null ? (
                <span className="text-muted-foreground text-xs">
                  {t('suggestions.rank', { rank: suggestion.rank })}
                </span>
              ) : null}
            </div>
            <CardTitle className="grid min-w-0 gap-2 text-base md:grid-cols-[1fr_auto_1fr] md:items-center">
              <span
                className="border-border bg-muted/40 min-w-0 break-all border p-3 font-mono text-sm"
                data-testid={`internal-links-source-${suggestion.id}`}
              >
                {suggestion.sourceUrl}
              </span>
              <ArrowRight className="mx-auto size-4 rtl:rotate-180" aria-hidden="true" />
              <span
                className="border-border bg-muted/40 min-w-0 break-all border p-3 font-mono text-sm"
                data-testid={`internal-links-target-${suggestion.id}`}
              >
                {suggestion.targetUrl}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-border border-s-2 ps-4">
              <p className="text-muted-foreground text-xs">{t('suggestions.anchorLabel')}</p>
              <p
                className="mt-1 whitespace-pre-wrap break-words text-base font-medium"
                data-testid={`internal-links-anchor-${suggestion.id}`}
              >
                {suggestion.anchorText}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy(suggestion)}
                  data-testid={`internal-links-copy-${suggestion.id}`}
                >
                  {copiedId === suggestion.id ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                  {copiedId === suggestion.id ? t('suggestions.copied') : t('suggestions.copy')}
                </Button>
                <CodeFixPromptButton
                  input={{
                    reference: 'internal-link-suggestion',
                    confidence: suggestion.confidence,
                    problem: t('suggestions.codeFixProblem'),
                    whyItMatters: t('suggestions.codeFixWhy'),
                    recommendedFix: t('suggestions.codeFixRecommendation'),
                    affectedUrls: [suggestion.sourceUrl, suggestion.targetUrl],
                    affectedUrlCount: 2,
                    supportingFacts: {
                      sourceUrl: suggestion.sourceUrl,
                      targetUrl: suggestion.targetUrl,
                      anchorText: suggestion.anchorText,
                    },
                  }}
                />
              </div>
            </div>
            <Separator />
            <Accordion type="single" collapsible dir={i18n.dir()}>
              <AccordionItem value="evidence">
                <AccordionTrigger>{t('evidence.title')}</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('evidence.inbound')}</dt>
                      <dd className="font-medium">{suggestion.targetInboundCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('evidence.flag')}</dt>
                      <dd className="font-medium">{t(`flags.${suggestion.targetFlag}`)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('evidence.inventoryDate')}</dt>
                      <dd className="break-all font-medium">{suggestion.inventoryDate}</dd>
                    </div>
                  </dl>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <section>
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <Network className="size-4" aria-hidden="true" />
                        {t('evidence.queries')}
                      </h3>
                      {suggestion.sharedQueries.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
                          {suggestion.sharedQueries.map((query) => (
                            <li key={query} className="break-words">{query}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground mt-2 text-sm">{t('evidence.none')}</p>
                      )}
                    </section>
                    <section>
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="size-4" aria-hidden="true" />
                        {t('evidence.headings')}
                      </h3>
                      {suggestion.headingMatches.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
                          {suggestion.headingMatches.map((heading) => (
                            <li key={heading} className="break-words">{heading}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground mt-2 text-sm">{t('evidence.none')}</p>
                      )}
                    </section>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
