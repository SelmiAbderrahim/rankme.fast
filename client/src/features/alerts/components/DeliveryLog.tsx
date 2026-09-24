import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { AlertDelivery, AlertDeliveryStatus, AlertEvidence } from '../types';

const STATUS_TONE: Record<AlertDeliveryStatus, StatusTone> = {
  sent: 'success',
  pending: 'warning',
  failed: 'destructive',
  suppressed: 'muted',
};

/** Date only — the stored observation pair carries no finer precision. */
const day = (iso: string) => iso.slice(0, 10);

interface DeliveryLogProps {
  deliveries: AlertDelivery[];
}

/**
 * Delivery log. Every row shows BOTH stored observations with their dates —
 * the honesty invariant made visible: an alert that cannot name what
 * changed, and when, is not rendered as a complete alert.
 *
 * Keywords and domains are untrusted text and render as text nodes only.
 */
export const DeliveryLog = ({ deliveries }: DeliveryLogProps) => {
  const { t } = useTranslation('alerts');

  const observationPair = (evidence: AlertEvidence): string => {
    if (evidence.kind === 'rank_drop') {
      return t('log.rankPair', {
        before: evidence.before.position ?? t('log.notRanked'),
        beforeAt: day(evidence.before.at),
        after: evidence.after.position ?? t('log.notRanked'),
        afterAt: day(evidence.after.at),
      });
    }
    return t('log.linkPair', {
      beforeCount: evidence.before.rowCount,
      beforeAt: day(evidence.before.at),
      afterCount: evidence.after.rowCount,
      afterAt: day(evidence.after.at),
    });
  };

  return (
    <Table data-testid="alerts-delivery-log">
      <TableHeader>
        <TableRow>
          <TableHead>{t('log.channel')}</TableHead>
          <TableHead>{t('log.status')}</TableHead>
          <TableHead>
            <TableHeaderHelp
              label={t('log.evidence')}
              description={t('common:tableHelp.alertEvidence')}
            />
          </TableHead>
          <TableHead>{t('log.detail')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <TableRow key={delivery.id} data-testid={`alerts-delivery-${delivery.id}`}>
            <TableCell>{t(`channel.${delivery.channel}`)}</TableCell>
            <TableCell>
              <StatusChip tone={STATUS_TONE[delivery.status]}>
                {t(`log.statusLabel.${delivery.status}`)}
              </StatusChip>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-1 text-sm">
                {delivery.evidence.kind === 'rank_drop' ? (
                  <span>{delivery.evidence.keyword}</span>
                ) : (
                  <span>{t('log.domainCount', { count: delivery.evidence.changedTotal })}</span>
                )}
                <span className="text-muted-foreground">{observationPair(delivery.evidence)}</span>
                {delivery.evidence.kind !== 'rank_drop' &&
                delivery.evidence.changedDomains.length > 0 ? (
                  <ul className="text-muted-foreground">
                    {delivery.evidence.changedDomains.map((domain) => (
                      <li key={domain}>{domain}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {delivery.suppressedReason
                ? t(`log.suppressed.${delivery.suppressedReason}`)
                : delivery.errorCode
                  ? t(`log.error.${delivery.errorCode}`)
                  : t('log.attempt', { attempt: delivery.attempt })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
