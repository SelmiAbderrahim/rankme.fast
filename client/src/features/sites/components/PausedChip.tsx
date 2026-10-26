import { useTranslation } from 'react-i18next';
import { StatusChip } from '@shared/ui/status-chip';
import { TableHeaderHelp } from '@shared/ui/table-header-help';

export interface PausedChipProps {
  siteId: string;
}

/**
 * The "Paused" status chip with its explanation. Used by the Sites list and the
 * Dashboard so both say the same thing about what pausing does. The help is a
 * focusable "About Paused" button whose tooltip opens on hover, focus, or tap,
 * so it is not mouse-only.
 */
export const PausedChip = ({ siteId }: PausedChipProps) => {
  const { t } = useTranslation('sites');
  return (
    <TableHeaderHelp
      label={
        <StatusChip tone="warning" data-testid={`site-paused-chip-${siteId}`}>
          {t('paused.chip')}
        </StatusChip>
      }
      labelText={t('paused.chip')}
      description={t('paused.help')}
    />
  );
};
