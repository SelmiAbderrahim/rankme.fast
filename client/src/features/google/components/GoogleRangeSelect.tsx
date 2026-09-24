/**
 * GoogleRangeSelect — the compact 7/28/90-day window picker shared by both
 * summary cards. Reads/writes the URL `?range=` param via `useGoogleRange`,
 * so ONE param drives both cards and the drill-in panel.
 */
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { GOOGLE_RANGES, useGoogleRange } from '../lib/range';
import type { GoogleRange } from '../types';

export interface GoogleRangeSelectProps {
  testId: string;
}

export const GoogleRangeSelect = ({ testId }: GoogleRangeSelectProps) => {
  const { t } = useTranslation('google');
  const [range, setRange] = useGoogleRange();

  return (
    <Select
      value={range}
      onValueChange={(value) => setRange(value as GoogleRange)}
    >
      <SelectTrigger size="sm" aria-label={t('range.label')} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GOOGLE_RANGES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(`range.${value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
