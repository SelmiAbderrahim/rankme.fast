import { siteLabel, type SiteLabelSource } from '@shared/lib/siteLabel';
import { Bdi } from './Bdi';

export interface SiteOptionLabelProps { site: SiteLabelSource; pausedLabel: string; }

export function SiteOptionLabel({ site, pausedLabel }: SiteOptionLabelProps) {
  const name = siteLabel(site);
  return <><Bdi>{name}</Bdi>{name === site.domain ? null : <>{' · '}<Bdi>{site.domain}</Bdi></>}{site.paused === true ? ` (${pausedLabel})` : null}</>;
}
