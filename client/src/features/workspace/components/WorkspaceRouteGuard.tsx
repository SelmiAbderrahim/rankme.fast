import type { ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAppSelector } from '@shared/hooks/redux';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { canOpenRoute } from '../navPolicy';
import { selectActiveWorkspaceRole, selectIsForeignWorkspace } from '../store/selectors';

/**
 * Renders a localized "not available here" state instead of letting an
 * owner-only page fire a request that answers 404
 * (`rankme-enterprise-orgs` 02).
 *
 * The server remains the authority — it 404s regardless — but a raw error
 * toast reads like a bug, whereas the real situation is simply that connections,
 * keys, and account settings stay with the workspace owner.
 */
export const WorkspaceRouteGuard = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation('team');
  const { pathname } = useLocation();
  const role = useAppSelector(selectActiveWorkspaceRole);
  const isForeign = useAppSelector(selectIsForeignWorkspace);

  if (canOpenRoute(pathname, role, isForeign)) return <>{children}</>;

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Building2 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('workspace.notAvailable.title')}</EmptyTitle>
        <EmptyDescription>{t('workspace.notAvailable.body')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
