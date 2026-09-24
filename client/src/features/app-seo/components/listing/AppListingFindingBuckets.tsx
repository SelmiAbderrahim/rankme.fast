import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import type {
  AppListingFinding,
  AppListingSeverity,
} from '../../listing-types';

const SEVERITIES: readonly AppListingSeverity[] = ['fixNow', 'watch', 'advisory'];

const severityClass = (severity: AppListingSeverity) => {
  if (severity === 'fixNow') return 'bg-destructive/10 text-destructive';
  if (severity === 'watch') return 'bg-warning/15 text-warning';
  return 'bg-info/10 text-info';
};

function FindingRow({ finding }: { finding: AppListingFinding }) {
  const { t } = useTranslation('appSeoListing');
  return (
    <li className="grid gap-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{finding.title}</p>
        <Badge className={severityClass(finding.severity)}>
          {t(`severity.${finding.severity}`)}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        {finding.why}
      </p>
      <p className="text-sm">{finding.fix}</p>
    </li>
  );
}

export function AppListingFindingBuckets({ findings }: { findings: AppListingFinding[] }) {
  const { t } = useTranslation('appSeoListing');
  const active = findings.filter((finding) => finding.status === 'finding');
  if (active.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('findings.none')}</p>;
  }
  return (
    <div className="grid gap-5">
      {SEVERITIES.map((severity) => {
        const bucket = active.filter((finding) => finding.severity === severity);
        if (bucket.length === 0) return null;
        return (
          <section key={severity}>
            <h4 className="mb-3 font-semibold">
              {t(`buckets.${severity}`, { count: bucket.length })}
            </h4>
            <ul className="grid gap-3">
              {bucket.map((finding) => (
                <FindingRow key={`${finding.scope}:${finding.id}`} finding={finding} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function AppListingNotEvaluated({ findings }: { findings: AppListingFinding[] }) {
  const { t } = useTranslation('appSeoListing');
  const pending = findings.filter((finding) => finding.status === 'notEvaluated');
  if (pending.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="font-medium">{t('notObserved.rulesTitle')}</p>
      <ul className="grid gap-2 text-sm text-muted-foreground">
        {pending.map((finding) => (
          <li key={`${finding.scope}:${finding.id}`} className="rounded-lg border border-border p-3">
            <span className="font-medium text-foreground">
              {finding.title}
            </span>{' '}
            {finding.notEvaluatedText}
          </li>
        ))}
      </ul>
    </div>
  );
}
