import { useParams } from 'react-router-dom';
import { BacklinksWorkspace } from './BacklinksWorkspace';

interface Props {
  siteId?: string;
}

/**
 * Shared route/embed adapter for the full Link Intelligence workspace.
 * Standalone URLs keep `?tab=`, while the site workspace owns that parameter
 * and therefore persists the nested backlinks view in `?view=`.
 */
export const BacklinksPage = ({ siteId: siteIdProp }: Props = {}) => {
  const params = useParams<{ siteId: string }>();
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <BacklinksWorkspace siteId={siteId} embedded={siteIdProp !== undefined} />;
};
