import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { AlertRule } from '../types';

interface RuleListProps {
  rules: AlertRule[];
  busyRuleId: string | null;
  onToggle: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
  onOpenLog: (rule: AlertRule) => void;
}

/**
 * Configured rules. Channel columns render MASKED values only — the Slack host
 * fragment and the four-character secret tail the server chose to disclose.
 * A webhook URL is customer-supplied text, so it renders as a text node and is
 * never turned into a link.
 */
export const RuleList = ({ rules, busyRuleId, onToggle, onDelete, onOpenLog }: RuleListProps) => {
  const { t } = useTranslation('alerts');
  return (
    <Table data-testid="alerts-rule-list">
      <TableHeader>
        <TableRow>
          <TableHead>{t('list.type')}</TableHead>
          <TableHead>
            <TableHeaderHelp
              label={t('list.threshold')}
              description={t('common:tableHelp.alertThreshold')}
            />
          </TableHead>
          <TableHead>{t('list.channels')}</TableHead>
          <TableHead>{t('list.state')}</TableHead>
          <TableHead>{t('list.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id} data-testid={`alerts-rule-${rule.id}`}>
            <TableCell>{t(`type.${rule.type}`)}</TableCell>
            <TableCell>{rule.threshold === null ? '—' : rule.threshold}</TableCell>
            <TableCell>
              <ul className="flex flex-col gap-1 text-sm">
                {rule.emailRecipientIds.length > 0 ? (
                  <li>{t('list.emailCount', { count: rule.emailRecipientIds.length })}</li>
                ) : null}
                {rule.slackConfigured ? <li>{rule.slackHostMasked}</li> : null}
                {rule.webhookUrl !== null ? (
                  <li>
                    <span>{rule.webhookUrl}</span>
                    {rule.webhookSecretLast4 !== null ? (
                      <span className="ms-2 text-muted-foreground">
                        {t('list.secretTail', { tail: rule.webhookSecretLast4 })}
                      </span>
                    ) : null}
                  </li>
                ) : null}
              </ul>
            </TableCell>
            <TableCell>
              <StatusChip tone={rule.enabled ? 'success' : 'muted'}>
                {t(rule.enabled ? 'list.enabled' : 'list.disabled')}
              </StatusChip>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={busyRuleId === rule.id}
                  onClick={() => onToggle(rule)}
                >
                  {t(rule.enabled ? 'list.disable' : 'list.enable')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onOpenLog(rule)}>
                  {t('list.viewLog')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  loading={busyRuleId === rule.id}
                  onClick={() => onDelete(rule)}
                >
                  {t('list.delete')}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
