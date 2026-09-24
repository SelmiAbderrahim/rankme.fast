import { useTranslation } from 'react-i18next';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import type { RankCadence } from '../types';

export interface CadenceToggleProps {
  cadence: RankCadence;
  disabled?: boolean;
  onChange: (next: RankCadence) => void;
}

export const CadenceToggle = ({ cadence, disabled = false, onChange }: CadenceToggleProps) => {
  const { t } = useTranslation('ranks');
  const isDaily = cadence === 'daily';

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        {t('cadenceTitle')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Label id="cadence-toggle-label" className="text-sm font-medium">
          {isDaily ? t('cadenceDaily') : t('cadenceWeekly')}
        </Label>
        <Switch
          checked={isDaily}
          disabled={disabled}
          onCheckedChange={(next) => onChange(next ? 'daily' : 'weekly')}
          aria-labelledby="cadence-toggle-label"
          data-testid="cadence-toggle"
        />
      </div>
    </div>
  );
};
