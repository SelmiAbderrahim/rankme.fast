import { Bdi } from '@shared/components/Bdi';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import {
  EVIDENCE_SOURCES,
  type EvidenceSource,
  type SchemaSources,
} from '../types';
import { isValidPastedPageUrl } from '../validation';
import { filterPages, groupPages, ROOT_GROUP, type PickablePage } from '../pageGroups';

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

interface PageRadioListProps<T extends PickablePage> {
  /** `audited` | `inventory` — keeps the shipped ids and test ids. */
  kind: 'audited' | 'inventory';
  legend: string;
  pages: readonly T[];
  value: string;
  onChange: (next: string) => void;
  renderMeta: (page: T) => ReactNode;
  /** Pages that exist beyond this list when the server capped it. */
  totalAvailable?: number;
}

/**
 * A searchable, grouped radio list. The filter narrows by address or title;
 * groups follow the first path segment (language folders on multilingual
 * sites). Titles are isolated with `dir="auto"` so a right-to-left title next
 * to a left-to-right brand name keeps its own reading order.
 */
function PageRadioList<T extends PickablePage>({
  kind,
  legend,
  pages,
  value,
  onChange,
  renderMeta,
  totalAvailable,
}: PageRadioListProps<T>) {
  const { t } = useTranslation('schemaGenerator');
  const [query, setQuery] = useState('');
  const visible = filterPages(pages, query);
  const groups = groupPages(visible);
  const grouped = groups.length > 1;
  const filterId = `schema-${kind}-filter`;
  const countId = `schema-${kind}-count`;
  const total = Math.max(totalAvailable ?? 0, pages.length);
  const capped = total > pages.length;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-col gap-1">
        <Label htmlFor={filterId}>{t('source.filterLabel')}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            id={filterId}
            type="search"
            className="ps-8"
            value={query}
            placeholder={t('source.filterPlaceholder')}
            aria-describedby={countId}
            data-testid={filterId}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p id={countId} className="text-muted-foreground text-xs" aria-live="polite">
          {t('source.filterCount', { shown: visible.length, total })}
        </p>
        {capped ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid={`schema-${kind}-capped`}
          >
            {t('source.listCapped', { count: pages.length, shown: pages.length, total })}
          </p>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid={`schema-${kind}-no-matches`}>
          {t('source.filterNoMatches')}
        </p>
      ) : (
        <RadioGroup
          value={value}
          onValueChange={onChange}
          className="flex max-h-96 flex-col gap-3 overflow-y-auto"
        >
          {groups.map((group, groupIndex) => (
            <div
              key={group.prefix}
              role={grouped ? 'group' : undefined}
              aria-labelledby={grouped ? `schema-${kind}-group-${groupIndex}` : undefined}
              className="flex flex-col gap-2"
              data-testid={`schema-${kind}-group-${group.prefix}`}
            >
              {grouped ? (
                <p
                  id={`schema-${kind}-group-${groupIndex}`}
                  className="bg-card text-muted-foreground sticky top-0 z-10 text-xs font-medium"
                >
                  {group.prefix === ROOT_GROUP ? (
                    t('source.groupRoot')
                  ) : (
                    <span dir="ltr" className="font-mono">
                      {group.prefix}
                    </span>
                  )}{' '}
                  <span className="tabular-nums">({group.pages.length})</span>
                </p>
              ) : null}
              {group.pages.map(({ page, index }) => (
                <div key={page.url} className="flex items-start gap-2">
                  <RadioGroupItem
                    value={page.url}
                    id={`schema-${kind}-${index}`}
                    className="mt-1"
                  />
                  <Label
                    htmlFor={`schema-${kind}-${index}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                    data-testid={`schema-${kind}-option-${index}`}
                  >
                    <span className="font-mono text-xs break-all" dir="ltr">
                      {page.url}
                    </span>
                    {page.title ? (
                      <Bdi
                        dominant
                        className="text-muted-foreground text-xs"
                        data-testid={`schema-${kind}-title-${index}`}
                      >
                        {page.title}
                      </Bdi>
                    ) : null}
                    {renderMeta(page)}
                  </Label>
                </div>
              ))}
            </div>
          ))}
        </RadioGroup>
      )}
    </fieldset>
  );
}

/**
 * Three evidence sources, one page selection (spec §10). The two stored lists
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
          <PageRadioList
            kind="audited"
            legend={t('source.auditedLegend')}
            pages={audited}
            totalAvailable={sources?.auditedPagesTotal ?? 0}
            value={pageUrl}
            onChange={onPageUrlChange}
            renderMeta={(page) => (
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
            )}
          />
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
          <PageRadioList
            kind="inventory"
            legend={t('source.inventoryLegend')}
            pages={inventory}
            value={pageUrl}
            onChange={onPageUrlChange}
            renderMeta={(page) => (
              <span className="text-muted-foreground text-xs break-all">
                {page.schemaTypes.length === 0
                  ? t('source.declaresNothing')
                  : t('source.declaresTypes', {
                      types: page.schemaTypes.join(', '),
                    })}
              </span>
            )}
          />
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
