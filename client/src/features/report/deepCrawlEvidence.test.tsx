import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { readDeepCrawlEvidence } from './deepCrawlEvidence';
import { DeepCrawlEvidenceBlocks, EvidenceFacts } from './components/DeepCrawlEvidence';

describe('deep crawl evidence', () => {
  it('keeps valid facts and discards malformed vendor rows', () => {
    const evidence = readDeepCrawlEvidence({
      pages: [null, { url: 'https://example.com/a', problems: ['largePage', 2], statusCode: 200, clickDepth: Number.NaN, contentEncoding: null, canonical: 'javascript:alert(1)' }],
      resources: [{ url: 'https://example.com/image.png', type: 'image', statusCode: 404, usedOn: ['https://example.com/a', 2], usedOnCount: 3 }],
      chains: [{ from: 'https://example.com/a', hops: [{ url: 'https://example.com/b', status: 301 }, null], isLoop: true }],
      groups: [{ urls: ['https://example.com/a', 'https://example.com/b'], title: '<script>bad</script>', similarity: 8 }, { urls: [] }],
      insecureResources: ['http://example.com/image.png', null],
      reachedThroughChain: ['https://example.com/b'],
      evidenceTruncated: 12,
    });
    expect(evidence.pages.get('https://example.com/a')).toMatchObject({ problems: ['largePage'], statusCode: 200, contentEncoding: null });
    expect(evidence.pages.get('https://example.com/a')).not.toHaveProperty('clickDepth');
    expect(evidence.resources.get('https://example.com/image.png')?.usedOn).toEqual(['https://example.com/a']);
    expect(evidence.chains[0]?.hops).toEqual([{ url: 'https://example.com/b', status: 301 }]);
    expect(evidence.groups).toHaveLength(1);
    expect(evidence.truncated).toBe(12);
  });

  it('renders facts as text and guards untrusted links', () => {
    initI18n({ initialLocale: 'en' });
    const evidence = readDeepCrawlEvidence({
      pages: [{ url: 'https://example.com/a', problems: ['largePage'], statusCode: 200, canonical: 'javascript:alert(1)', contentEncoding: null }],
      chains: [{ from: 'https://example.com/a', hops: [{ url: 'https://example.com/b', status: 301 }], isLoop: false }],
      groups: [{ urls: ['https://example.com/a'], title: '<script>bad</script>' }],
      insecureResources: ['http://example.com/image.png'],
      evidenceTruncated: 5,
    });
    render(<I18nextProvider i18n={i18n}><EvidenceFacts page={evidence.pages.get('https://example.com/a')} /><DeepCrawlEvidenceBlocks evidence={evidence} shownRows={1} /></I18nextProvider>);
    expect(screen.getByText('Not compressed')).toBeInTheDocument();
    expect(screen.getByText('<script>bad</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    const facts = screen.getByTestId('report-evidence-facts');
    expect(within(facts).getByText('Canonical points to')).toBeInTheDocument();
    expect(within(facts).getByText('javascript:alert(1)').closest('a')).not.toHaveAttribute('href', 'javascript:alert(1)');
    expect(screen.getByTestId('report-evidence-chain')).toHaveTextContent('Status 301');
    expect(screen.getByTestId('report-evidence-cut')).toHaveTextContent('first 1 of 5');
  });
});
