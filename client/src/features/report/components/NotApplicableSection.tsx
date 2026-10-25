/**
 * "Not applicable to this site" group of the audit report.
 *
 * Local SEO checks on a site that is not a local business are not "not
 * evaluated" — they simply do not apply. The server moves them out of the
 * findings and out of every count; this collapsed, neutral group lists them
 * and lets the owner say "This is a local business", which turns them back
 * into ordinary checks.
 *
 * data-testid contract:
 *   - report-not-applicable              section root
 *   - report-not-applicable-item         one per check
 *   - report-not-applicable-opt-in       "This is a local business" button
 *   - report-not-applicable-error        opt-in failure
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Button } from '@shared/ui/button';
import { Bdi } from '@shared/components/Bdi';
import { markLocalBusinessRequest } from '../api';
import type { LocalizedFinding } from '../types';

interface NotApplicableSectionProps {
  findings: readonly LocalizedFinding[];
  siteId: string;
  /** Called after the site is marked as a local business, to reload the report. */
  onChanged: () => void;
}

export const NotApplicableSection = ({ findings, siteId, onChanged }: NotApplicableSectionProps) => {
  const { t } = useTranslation('report');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (findings.length === 0) return null;

  const optIn = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await markLocalBusinessRequest(siteId);
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="bg-card rounded-xl border px-4"
      aria-label={t('notApplicable.title')}
      data-testid="report-not-applicable"
    >
      <Accordion type="single" collapsible>
        <AccordionItem value="not-applicable" className="border-b-0">
          <AccordionTrigger className="py-3 text-base">
            <span>
              {t('notApplicable.title')}
              <span className="text-muted-foreground ms-2 font-normal tabular-nums">({findings.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3 pb-4">
            <p className="text-muted-foreground text-sm">{t('notApplicable.description')}</p>
            <ul className="flex flex-col gap-1">
              {findings.map((finding) => (
                <li
                  key={finding.ruleId}
                  className="text-foreground text-sm"
                  data-testid="report-not-applicable-item"
                  data-rule-id={finding.ruleId}
                >
                  <Bdi>{finding.copy.title}</Bdi>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={saving}
                loadingLabel={t('notApplicable.saving')}
                onClick={() => void optIn()}
                data-testid="report-not-applicable-opt-in"
              >
                {t('notApplicable.optIn')}
              </Button>
              <p className="text-muted-foreground text-sm">{t('notApplicable.optInHint')}</p>
            </div>
            {failed ? (
              <p role="alert" className="text-destructive text-sm" data-testid="report-not-applicable-error">
                {t('notApplicable.failed')}
              </p>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
};
