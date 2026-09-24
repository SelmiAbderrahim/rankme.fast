import { useParams } from 'react-router-dom';
import { AiVisibilityPanel } from './AiVisibilityPanel';

export const AiVisibilityPage = ({ siteId: siteIdProp }: { siteId?: string }) => {
  const params = useParams<{ siteId: string }>();
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <AiVisibilityPanel siteId={siteId} />;
};
