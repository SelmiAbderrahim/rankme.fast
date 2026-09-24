import { useTranslation } from 'react-i18next';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import {
  EVIDENCE_SOURCES,
  type EvidenceSource,
  type SchemaSources,
} from '../types';
import { isValidPastedPageUrl } from '../validation';

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  'audited-page': 'source.audited',
  'inventory-page': 'source.inventory',
  url: 'source.url',
};

interface PagePickerProps {
  source: EvidenceSource;
  pageUrl: string;
  sources: SchemaSources | null;
  onSourceChange: (next: EvidenceSource) => void;
  onPageUrlChange: (next: string) => void;
}

/**
 * Three evidence sources, one page selection. The two stored lists
 * carry the crawl/inventory context that explains WHY a page is worth marking
 * up — they never fetch anything. The pasted-URL field is validated against
 * the same shape the server enforces before a request leaves the browser.
 */
export const PagePicker = ({
  source,
  pageUrl,
  sources,
  onSourceChange,
  onPageUrlChange,
}: PagePickerProps) => {
  const { t } = useTranslation('schemaGenerator');
  const audited = sources?.auditedPages ?? [];
  const inventory = sources?.inventoryPages ?? [];
  const urlInvalid = source === 'url' && pageUrl.trim() !== '' && !isValidPastedPageUrl(pageUrl);

  return (
    <div className="flex flex-col gap-4" data-testid="schema-page-picker">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('source.legend')}</legend>
        <RadioGroup
          value={source}
          onValueChange={(value) => onSourceChange(value as EvidenceSource)}
          className="flex flex-wrap gap-4"
        >
          {EVIDENCE_SOURCES.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem value={option} id={`schema-source-${option}`} />
              <Label htmlFor={`schema-source-${option}`}>{t(SOURCE_LABEL[option])}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {source === 'audited-page' ? (
        audited.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="schema-audited-empty">
            {t('source.auditedEmpty')}
          </p>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('source.auditedLegend')}</legend>
            <RadioGroup
              value={pageUrl}
              onValueChange={onPageUrlChange}
              className="flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {audited.map((page, index) => (
                <div key={page.url} className="flex items-start gap-2">
                  <RadioGroupItem
                    value={page.url}
                    id={`schema-audited-${index}`}
                    className="mt-1"
                  />
                  <Label
                    htmlFor={`schema-audited-${index}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                    data-testid={`schema-audited-option-${index}`}
                  >
                    <span className="font-mono text-xs break-all" dir="ltr">{page.url}</span>
                    {page.title ? (
                      <span className="text-muted-foreground text-xs">{page.title}</span>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {page.hasStructuredData
                        ? t('source.hasStructuredData')
                        : t('source.noStructuredData')}
                      {page.structuredDataErrors > 0
                        ? ` · ${t('source.structuredDataErrors', {
                            n: page.structuredDataErrors,
                          })}`
                        : ''}
                      {page.richResultsVerdict
                        ? ` · ${t('source.richResultsVerdict', {
                            verdict: page.richResultsVerdict,
                          })}`
                        : ''}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        )
      ) : null}

      {source === 'inventory-page' ? (
        inventory.length === 0 ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="schema-inventory-empty"
          >
            {t('source.inventoryEmpty')}
          </p>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              {t('source.inventoryLegend')}
            </legend>
            <RadioGroup
              value={pageUrl}
              onValueChange={onPageUrlChange}
              className="flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {inventory.map((page, index) => (
                <div key={page.url} className="flex items-start gap-2">
                  <RadioGroupItem
                    value={page.url}
                    id={`schema-inventory-${index}`}
                    className="mt-1"
                  />
                  <Label
                    htmlFor={`schema-inventory-${index}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                    data-testid={`schema-inventory-option-${index}`}
                  >
                    <span className="font-mono text-xs break-all" dir="ltr">{page.url}</span>
                    <span className="text-muted-foreground text-xs break-all">
                      {page.schemaTypes.length === 0
                        ? t('source.declaresNothing')
                        : t('source.declaresTypes', {
                            types: page.schemaTypes.join(', '),
                          })}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        )
      ) : null}

      {source === 'url' ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="schema-page-url">{t('source.urlLabel')}</Label>
          <Input
            id="schema-page-url"
            name="schema-page-url"
            type="url"
            inputMode="url"
            value={pageUrl}
            placeholder={t('source.urlPlaceholder')}
            aria-invalid={urlInvalid || undefined}
            aria-describedby={urlInvalid ? 'schema-page-url-error' : undefined}
            dir="ltr"
            onChange={(event) => onPageUrlChange(event.target.value)}
          />
          {urlInvalid ? (
            <p
              id="schema-page-url-error"
              role="alert"
              className="text-destructive text-sm"
              data-testid="schema-url-error"
            >
              {t('source.urlInvalid')}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">{t('source.urlHint')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
};
