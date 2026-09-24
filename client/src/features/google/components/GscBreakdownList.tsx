/**
 * GscBreakdownList — a generic compact breakdown used for the country/device
 * splits of the search summary AND the channel/page/country/device splits of
 * the GA4 analytics card. Each row shows a label, a flat proportion bar
 * (share of `total`) and the row's `value · rate` pair (clicks · CTR for GSC,
 * sessions · engagement rate for GA4). The whole thing is a semantic
 * `<table>` (sr-only caption + header row) so screen readers get the labelled
 * data while sighted users see a dense list.
 */
import { useTranslation } from 'react-i18next';
import { formatInt, formatPercent } from '../lib/format';

export interface GscBreakdownRow {
  id: string;
  label: string;
  /** Primary count (clicks / sessions). */
  value: number;
  /** Secondary 0..1 rate rendered as a percentage (CTR / engagement rate). */
  rate: number;
}

export interface GscBreakdownListProps {
  title: string;
  caption: string;
  emptyLabel: string;
  keyHeader: string;
  /** sr-only header for the numeric column, e.g. "Clicks · CTR". */
  valueHeader: string;
  rows: GscBreakdownRow[];
  /** Denominator for the proportion bar (total clicks / total sessions). */
  total: number;
  testId: string;
}

export const GscBreakdownList = ({
  title,
  caption,
  emptyLabel,
  keyHeader,
  valueHeader,
  rows,
  total,
  testId,
}: GscBreakdownListProps) => {
  const { i18n } = useTranslation('google');
  const locale = i18n.language;

  return (
    <div data-testid={testId}>
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {title}
      </p>
      {rows.length === 0 ? (
        <p
          className="text-muted-foreground mt-2 text-sm"
          data-testid={`${testId}-empty`}
        >
          {emptyLabel}
        </p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">{keyHeader}</th>
              <th scope="col">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pct = total === 0 ? 0 : (row.value / total) * 100;
              return (
                <tr key={row.id}>
                  <th
                    scope="row"
                    className="py-1 pe-3 text-start align-top font-normal"
                  >
                    <span className="block truncate" title={row.label}>
                      {row.label}
                    </span>
                    <span
                      role="progressbar"
                      aria-label={row.label}
                      aria-valuenow={Math.round(pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="bg-muted mt-1 block h-1.5 w-full overflow-hidden rounded-full"
                    >
                      <span
                        className="bg-primary block h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </th>
                  <td
                    className="text-muted-foreground py-1 ps-3 text-end align-top tabular-nums whitespace-nowrap"
                    dir="ltr"
                  >
                    {`${formatInt(locale, row.value)} · ${formatPercent(locale, row.rate)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
