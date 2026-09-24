import { ContentIntelligencePanel } from './ContentIntelligencePanel';

interface ContentIntelligencePageProps {
  siteId: string;
  siteOrigin?: string | undefined;
}

export function ContentIntelligencePage({ siteId, siteOrigin }: ContentIntelligencePageProps) {
  return <ContentIntelligencePanel siteId={siteId} siteOrigin={siteOrigin} />;
}
