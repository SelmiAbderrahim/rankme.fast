/**
 * "Scan images, scripts and styles" option of the audit start dialog.
 *
 * On by default. A scanning audit crawls at most `RESOURCE_SCAN_MAX_PAGES`
 * pages (the server enforces the same limit), so while the option is ticked
 * the note says so when the chosen page limit is above it. Unticking the
 * option lets the audit crawl up to the chosen page limit.
 *
 * data-testid contract:
 *   - report-resource-scan        the checkbox
 *   - report-resource-scan-note   shown while ticked and the page limit is above the scan limit
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@shared/ui/checkbox';
import { Label } from '@shared/ui/label';

export const RESOURCE_SCAN_MAX_PAGES = 1000;

export interface ResourceScanOptionProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The chosen crawl ceiling; `null` is the server's maximum. */
  pageLimit: number | null;
  /** A run is starting or in flight. */
  disabled?: boolean;
}

export const ResourceScanOption = ({
  checked,
  onCheckedChange,
  pageLimit,
  disabled,
}: ResourceScanOptionProps) => {
  const { t, i18n } = useTranslation('report');
  const checkboxId = useId();
  const pages = new Intl.NumberFormat(i18n.language).format(RESOURCE_SCAN_MAX_PAGES);
  const covered = pageLimit !== null && pageLimit <= RESOURCE_SCAN_MAX_PAGES;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        aria-describedby={`${checkboxId}-help`}
        data-testid="report-resource-scan"
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor={checkboxId}>{t('resourceScan.label')}</Label>
        <p id={`${checkboxId}-help`} className="text-muted-foreground text-xs">
          {t('resourceScan.help', { pages })}
        </p>
        {checked && !covered ? (
          <p className="text-muted-foreground text-xs" data-testid="report-resource-scan-note">
            {t('resourceScan.notCovered', { pages })}
          </p>
        ) : null}
      </div>
    </div>
  );
};
