import { useEffect } from 'react';
import { loadKeywords } from '@features/ranks';
import { useAppDispatch } from '@shared/hooks/redux';
import { loadHistory } from '../store/thunks';
import { KeywordResearchPanel } from './KeywordResearchPanel';
import { KeywordIntelligenceWorkspace } from './KeywordIntelligenceWorkspace';

/**
 * Route entrypoint (`/keyword-research`, no siteId) and site-workspace panel
 * (`?tab=research`, siteId set → the panel shows its track-keyword action).
 *
 * On mount it loads the account's recent research history, which populates
 * the "Recent research" list the panel shows. The read is free (Postgres), so
 * we refetch on every mount for freshness.
 *
 * The STANDALONE route renders the keyword-intelligence workspace
 * shell (`?tab=research|gap|trends|clusters`); the site-workspace embed keeps
 * the plain research panel unchanged because `?tab=` there is owned by
 * `SITE_TABS` (rejected-alternative note in the spec).
 */
export const KeywordResearchPage = ({ siteId }: { siteId?: string | null }) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    void dispatch(loadHistory({}));
  }, [dispatch]);

  useEffect(() => {
    if (!siteId) return;
    // Always request the initial page: the ranks slice may otherwise be holding
    // page 2 after the user paged through the Keywords tab.
    const request = dispatch(loadKeywords({ siteId, direction: 'initial' }));
    return () => request.abort();
  }, [dispatch, siteId]);

  if (!siteId) return <KeywordIntelligenceWorkspace />;
  return <KeywordResearchPanel siteId={siteId} />;
};
