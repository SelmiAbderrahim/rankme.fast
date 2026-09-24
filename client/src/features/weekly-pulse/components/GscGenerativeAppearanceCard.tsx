/**
 * Google generative-AI appearance card — placed inside the Google tab of
 * the site workspace.
 *
 * States: loading skeleton, available (rows), unavailable (empty),
 * partial (mixed data), reconnect_required (CTA), failed (error).
 * Never merged with provider mention metrics.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { fetchGenerativeAppearance } from '../store/thunks';
import {
  selectPulseGscAppearance,
  selectPulseGscError,
  selectPulseGscLoading,
} from '../store/selectors';

interface GscGenerativeAppearanceCardProps {
  siteId: string;
}

export function GscGenerativeAppearanceCard({ siteId }: GscGenerativeAppearanceCardProps) {
  const { t } = useTranslation('weeklyPulse');
  const dispatch = useAppDispatch();
  const appearance = useAppSelector(selectPulseGscAppearance);
  const loading = useAppSelector(selectPulseGscLoading);
  const error = useAppSelector(selectPulseGscError);

  useEffect(() => {
    void dispatch(fetchGenerativeAppearance({ siteId }));
  }, [dispatch, siteId]);

  return (
    <section
      className="rounded-xl border p-4"
      aria-labelledby={`gsc-gen-title-${siteId}`}
      data-testid="gsc-generative-appearance-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`gsc-gen-title-${siteId}`} className="text-lg font-semibold">
          {t('gsc.title')}
        </h2>
        {appearance ? (
          <ReportExportControl
            kind="google.gsc_generative_appearance"
            target={{ scope: 'site', siteId }}
            selection={{}}
          />
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t('gsc.description')}</p>

      {loading && !appearance ? (
        <p className="text-muted-foreground mt-3 text-sm" aria-busy="true">
          {t('gsc.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error.reconnectRequired ? t('errors.reconnectRequired') : t('errors.unexpected')}
        </p>
      ) : appearance ? (
        <GscAppearanceContent appearance={appearance} />
      ) : null}
    </section>
  );
}

function GscAppearanceContent({
  appearance,
}: {
  appearance: NonNullable<
    ReturnType<typeof useAppSelector<ReturnType<typeof selectPulseGscAppearance>>>
  >;
}) {
  const { t } = useTranslation('weeklyPulse');
  const status = appearance.status;

  if (status === 'reconnect_required') {
    return (
      <p className="text-muted-foreground mt-3 text-sm" data-testid="gsc-reconnect">
        {t('gsc.reconnect')}
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <p role="alert" className="text-destructive mt-3 text-sm">
        {t('errors.unexpected')}
      </p>
    );
  }
  if (status === 'partial') {
    return (
      <p className="text-muted-foreground mt-3 text-sm" data-testid="gsc-partial">
        {t('gsc.status.partial')}
      </p>
    );
  }
  if (status === 'unavailable' || appearance.rows.every((r) => !r.isGenerative)) {
    return (
      <p className="text-muted-foreground mt-3 text-sm" data-testid="gsc-empty">
        {t('gsc.empty')}
      </p>
    );
  }
  const rows = appearance.rows.filter((r) => r.isGenerative);
  return (
    <div className="mt-3">
      {appearance.window ? (
        <p className="text-muted-foreground text-xs">
          {t('gsc.window', {
            start: appearance.window.start,
            end: appearance.window.end,
          })}
        </p>
      ) : null}
      <ul className="mt-2 text-sm">
        {rows.map((r) => (
          <li key={r.rawAppearance} data-testid="gsc-appearance-row">
            {t('gsc.row', {
              appearance: r.rawAppearance,
              clicks: r.clicks,
              impressions: r.impressions,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
