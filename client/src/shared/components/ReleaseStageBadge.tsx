import { useTranslation } from 'react-i18next';
import { BRAND_NAME } from '@shared/brand';
import { isBeta } from '@shared/config/release';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';

/**
 * Static "Beta" badge shown beside the logo in the shared chrome while
 * `VITE_RELEASE_STAGE` is `beta` (SPEC-A8). Screen readers hear the full
 * "RankMeFast, public beta" name instead of the bare word.
 */
export const ReleaseStageBadge = ({ className }: { className?: string }) => {
  const { t } = useTranslation('common');
  if (!isBeta()) return null;

  return (
    <Badge className={cn('shrink-0', className)} data-testid="release-stage-badge" variant="outline">
      <span aria-hidden="true">{t('releaseStage.badge')}</span>
      <span className="sr-only">{t('releaseStage.badgeName', { brand: BRAND_NAME })}</span>
    </Badge>
  );
};
