/**
 * Checks the audit could not run because their data source is missing
 * (Search Console not connected, no review source, no field data, …).
 * They are listed apart from the Fix now / Watch / Passed tabs and never
 * counted as open problems.
 *
 * data-testid contract:
 *   - report-not-evaluated          section root
 *   - report-not-evaluated-row      one per check (data-rule-id)
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { StatusChip } from '@shared/ui/status-chip';
import {
  isAiVisibilityRuleId,
  isGscSearchRuleId,
  isGscSitemapRuleId,
  isLocalSeoRuleId,
  isPageSpeedRuleId,
  type LocalizedFinding,
} from '../types';

const INDEX_STATUS_RULE_IDS = ['not-indexed', 'rich-results-issues', 'index-partial'];

export type NotEvaluatedSource =
  | 'gsc'
  | 'gscReconnect'
  | 'pageSpeed'
  | 'localSeo'
  | 'aiVisibility'
  | 'generic';

/** Which missing data source kept this check from running. */
export const notEvaluatedSource = (finding: LocalizedFinding): NotEvaluatedSource => {
  const { ruleId } = finding;
  if (
    isGscSearchRuleId(ruleId) ||
    isGscSitemapRuleId(ruleId) ||
    INDEX_STATUS_RULE_IDS.includes(ruleId)
  ) {
    return finding.meta?.reason === 'needs-reconnect' ? 'gscReconnect' : 'gsc';
  }
  if (isPageSpeedRuleId(ruleId)) return 'pageSpeed';
  if (isLocalSeoRuleId(ruleId)) return 'localSeo';
  if (isAiVisibilityRuleId(ruleId)) return 'aiVisibility';
  return 'generic';
};

export interface NotEvaluatedChecksProps {
  findings: LocalizedFinding[];
}

export const NotEvaluatedChecks = ({ findings }: NotEvaluatedChecksProps) => {
  const { t } = useTranslation('report');
  if (findings.length === 0) return null;
  return (
    <Card data-testid="report-not-evaluated">
      <CardHeader>
        <CardTitle>
          <h2>
            {t('notEvaluated.title')}
            <span className="text-muted-foreground ms-2 tabular-nums">({findings.length})</span>
          </h2>
        </CardTitle>
        <CardDescription>{t('notEvaluated.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {findings.map((finding) => (
            <li
              key={finding.ruleId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-testid="report-not-evaluated-row"
              data-rule-id={finding.ruleId}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{finding.copy.title}</span>
                <span className="text-muted-foreground block text-xs">
                  {t(`notEvaluated.sources.${notEvaluatedSource(finding)}`)}
                </span>
              </span>
              <StatusChip tone="muted">{t('notEvaluated.badge')}</StatusChip>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
