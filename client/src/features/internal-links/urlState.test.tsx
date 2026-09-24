import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  isInternalLinkConfidenceFilter,
  isInternalLinkObjectId,
  isInternalLinkSection,
  isInternalLinkView,
  isInternalLinkTargetFilter,
  useInternalLinkUrlState,
} from './urlState';

const SITE = 'a'.repeat(24);
const RUN = 'b'.repeat(24);
let search = '';

const Probe = () => {
  const state = useInternalLinkUrlState();
  search = useLocation().search;
  return (
    <div>
      <span data-testid="values">
        {state.view}|{state.runId}|{state.target}|{state.section}|{state.confidence}
      </span>
      <button type="button" onClick={() => state.setView('new')}>new</button>
      <button type="button" onClick={() => state.setView('runs')}>runs</button>
      <button type="button" onClick={() => state.setRunId(RUN)}>run</button>
      <button type="button" onClick={() => state.setRunId(null)}>clear-run</button>
      <button type="button" onClick={() => state.setTarget('orphan')}>target</button>
      <button type="button" onClick={() => state.setTarget('all')}>all-targets</button>
      <button type="button" onClick={() => state.setSection('/blog')}>section</button>
      <button type="button" onClick={() => state.setSection('all')}>all-sections</button>
      <button type="button" onClick={() => state.setConfidence('high')}>confidence</button>
      <button type="button" onClick={() => state.setConfidence('all')}>all-confidence</button>
    </div>
  );
};

const renderProbe = (entry = `/sites/${SITE}?tab=internal-links`) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
    </MemoryRouter>,
  );

describe('internal-link URL state', () => {
  it('composes writes and removes defaults/null values', async () => {
    const user = userEvent.setup();
    renderProbe();
    for (const label of ['new', 'run', 'target', 'section', 'confidence']) {
      await user.click(screen.getByText(label));
    }
    expect(search).toContain('view=new');
    expect(search).toContain(`run=${RUN}`);
    expect(search).toContain('target=orphan');
    expect(search).toContain('section=%2Fblog');
    expect(search).toContain('confidence=high');
    for (const label of ['runs', 'clear-run', 'all-targets', 'all-sections', 'all-confidence']) {
      await user.click(screen.getByText(label));
    }
    expect(search).toBe('?tab=internal-links');
  });

  it('normalizes every invalid or explicit-default parameter out of the URL', async () => {
    renderProbe(
      `/sites/${SITE}?tab=internal-links&view=runs&run=y&target=all&section=bad&confidence=all`,
    );
    await act(async () => {});
    expect(search).toBe('?tab=internal-links');
    expect(screen.getByTestId('values')).toHaveTextContent('runs||all|all|all');
  });

  it('preserves legal non-default parameters while deleting invalid neighbors', async () => {
    renderProbe(`/sites/${SITE}?tab=internal-links&run=bad&target=orphan`);
    await act(async () => {});
    expect(search).toBe('?tab=internal-links&target=orphan');
  });

  it('accepts all legal enum values and rejects malformed primitives', () => {
    expect(isInternalLinkView('new')).toBe(true);
    expect(isInternalLinkView(1)).toBe(false);
    expect(isInternalLinkTargetFilter('weakly_linked')).toBe(true);
    expect(isInternalLinkTargetFilter('weak')).toBe(false);
    expect(isInternalLinkConfidenceFilter('low')).toBe(true);
    expect(isInternalLinkConfidenceFilter(null)).toBe(false);
    expect(isInternalLinkObjectId(SITE)).toBe(true);
    expect(isInternalLinkObjectId(SITE.toUpperCase())).toBe(false);
    expect(isInternalLinkObjectId(null)).toBe(false);
    expect(isInternalLinkSection('/')).toBe(true);
    expect(isInternalLinkSection('/blog')).toBe(true);
    expect(isInternalLinkSection('blog')).toBe(false);
    expect(isInternalLinkSection('/<script>')).toBe(false);
    expect(isInternalLinkSection(null)).toBe(false);
  });
});
