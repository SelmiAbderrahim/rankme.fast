import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@shared/ui/accordion';
import { StatusChip } from '@shared/ui/status-chip';
import type { BrandRadarDigestState, BrandRadarMentionRow } from '../types';
import { brandRadarMentionAnchor } from './MentionTable';

interface DigestSectionProps {
  digestState: BrandRadarDigestState;
  sentences: Array<{ text: string; citedRowIds: string[] }>;
  /** The mention page currently loaded — citations resolve against it. */
  mentions: BrandRadarMentionRow[];
}

/**
 * The AI interpretation of a scan.
 *
 * Labelled as AI output, rendered as text nodes, and never fabricated: each
 * non-`digest_present` state has its own honest branch. Citations sit behind a
 * disclosure and resolve against the LOADED mention page — an id that is not
 * on the page says so rather than disappearing.
 */
export const DigestSection = ({
  digestState,
  sentences,
  mentions,
}: DigestSectionProps) => {
  const { t } = useTranslation('brandRadar');

  return (
    <section className="flex flex-col gap-3" data-testid="brand-radar-digest">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('detail.digest.title')}</h3>
        <StatusChip tone="info">{t('detail.digest.aiLabel')}</StatusChip>
      </div>

      {digestState === 'pending' ? (
        <p data-testid="brand-radar-digest-pending">{t('detail.digest.pending')}</p>
      ) : null}
      {digestState === 'digest_absent' ? (
        <p data-testid="brand-radar-digest-absent">{t('detail.digest.absent')}</p>
      ) : null}
      {digestState === 'no_reliable_digest' ? (
        <p data-testid="brand-radar-digest-withheld">{t('detail.digest.withheld')}</p>
      ) : null}

      {digestState === 'digest_present' ? (
        <ol className="flex flex-col gap-3" data-testid="brand-radar-digest-sentences">
          {sentences.map((sentence, index) => (
            <li key={`${index}-${sentence.text}`} className="flex flex-col gap-1">
              {/* SEC-OUT: AI text renders as a text node, never as HTML. */}
              <p>{sentence.text}</p>
              <Accordion type="single" collapsible>
                <AccordionItem value={`citations-${index}`}>
                  <AccordionTrigger data-testid="brand-radar-citation-trigger">
                    {t('detail.digest.citations', { count: sentence.citedRowIds.length })}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="flex flex-col gap-1">
                      {sentence.citedRowIds.map((rowId) => {
                        const row = mentions.find((mention) => mention.id === rowId);
                        return (
                          <li key={rowId}>
                            {row ? (
                              <a
                                href={`#${brandRadarMentionAnchor(row.id)}`}
                                className="underline underline-offset-2"
                                data-testid="brand-radar-citation-resolved"
                              >
                                {row.domain}
                              </a>
                            ) : (
                              <span data-testid="brand-radar-citation-unresolved">
                                {t('detail.digest.citationMissing')}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};
