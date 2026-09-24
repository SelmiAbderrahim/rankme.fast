import { useParams } from 'react-router-dom';
import { LocalSeoPanel } from './LocalSeoPanel';

export const LocalSeoPage = ({ siteId: siteIdProp }: { siteId?: string }) => {
  const params = useParams<{ siteId: string }>();
  /* c8 ignore next -- route matcher guarantees siteId; fallback for prop-only mounts. */
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <LocalSeoPanel siteId={siteId} />;
};
