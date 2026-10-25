import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { AiVisibilityPanel } from './AiVisibilityPanel';

export const AiVisibilityPage = ({
  siteId: siteIdProp,
  pulse,
}: {
  siteId?: string;
  /** Section rendered under the page title (owned by the workspace): the weekly pulse. */
  pulse?: ReactNode;
}) => {
  const params = useParams<{ siteId: string }>();
  const siteId = siteIdProp ?? params.siteId ?? '';
  return <AiVisibilityPanel siteId={siteId} pulse={pulse} />;
};
