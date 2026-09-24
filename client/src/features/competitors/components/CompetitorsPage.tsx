import { useParams } from 'react-router-dom';
import { CompetitorWorkspace } from './CompetitorWorkspace';

interface Props {
  siteId?: string;
}

export const CompetitorsPage = (props: Props = {}) => {
  const { siteId: siteIdProp } = props;
  const params = useParams<{ siteId: string }>();
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <CompetitorWorkspace siteId={siteId} />;
};
