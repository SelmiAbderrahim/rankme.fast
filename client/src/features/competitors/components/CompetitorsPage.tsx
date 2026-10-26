import { useParams } from 'react-router-dom';
import { CompetitorWorkspace } from './CompetitorWorkspace';

interface Props {
  siteId?: string;
  /** The site's own domain, used to refuse it as a competitor before submitting. */
  siteDomain?: string;
}

export const CompetitorsPage = (props: Props = {}) => {
  const { siteId: siteIdProp, siteDomain } = props;
  const params = useParams<{ siteId: string }>();
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <CompetitorWorkspace siteId={siteId} siteDomain={siteDomain} />;
};
