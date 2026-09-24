import { describe, expect, it } from 'vitest';
import {
  applyClusterLabelsAiOutput,
  KeywordClusterAiOutputContractError,
  validateClusterLabelsAiOutput,
} from './keyword-clusters.ai-contract.js';
import { clusterKeywordsBySerpOverlap } from './keyword-clusters.overlap.js';
import type { KeywordCluster } from './keyword-clusters.schemas.js';

const OBSERVED = '2026-08-04T00:00:00.000Z';
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (n: number): string => `https://example.com/result-${n}`;

/** Two grouped clusters plus one singleton — the full shape under test. */
function fixtureClusters(): KeywordCluster[] {
  return clusterKeywordsBySerpOverlap({
    keywords: [
      { keywordId: uuid(1), phrase: 'aaa running shoes', observedAt: OBSERVED, topUrls: [1, 2, 3, 4].map(url) },
      { keywordId: uuid(2), phrase: 'aab running shoes', observedAt: OBSERVED, topUrls: [1, 2, 3, 9].map(url) },
      { keywordId: uuid(3), phrase: 'bbb hiking boots', observedAt: OBSERVED, topUrls: [20, 21, 22].map(url) },
      { keywordId: uuid(4), phrase: 'bbc hiking boots', observedAt: OBSERVED, topUrls: [20, 21, 22].map(url) },
      { keywordId: uuid(5), phrase: 'ccc lone keyword', observedAt: OBSERVED, topUrls: [80].map(url) },
    ],
  });
}

const good = {
  labels: [
    { clusterId: 'cluster-1', label: 'Running shoes' },
    { clusterId: 'cluster-2', label: 'Hiking boots' },
  ],
  citations: ['cluster-1', 'cluster-2'],
};

describe('validateClusterLabelsAiOutput', () => {
  it('accepts a response that names only supplied clusters', () => {
    const clusters = fixtureClusters();
    expect(() => validateClusterLabelsAiOutput(good, clusters)).not.toThrow();
  });

  it('accepts an empty label set — labelling is best effort', () => {
    const clusters = fixtureClusters();
    expect(
      validateClusterLabelsAiOutput({ labels: [], citations: [] }, clusters).labels,
    ).toEqual([]);
  });

  it.each([
    ['a schema-invalid response', { labels: [{ clusterId: 'cluster-1' }], citations: [] }],
    ['a non-object response', 'nope'],
    [
      'an unknown cluster id',
      { labels: [{ clusterId: 'cluster-9', label: 'Invented' }], citations: [] },
    ],
    [
      'a malformed cluster id',
      { labels: [{ clusterId: 'not-a-cluster', label: 'Invented' }], citations: [] },
    ],
    [
      'a repeated cluster id',
      {
        labels: [
          { clusterId: 'cluster-1', label: 'One' },
          { clusterId: 'cluster-1', label: 'Two' },
        ],
        citations: [],
      },
    ],
    [
      'an over-long label',
      {
        labels: [{ clusterId: 'cluster-1', label: 'x'.repeat(61) }],
        citations: [],
      },
    ],
    [
      'a structural field the schema does not allow',
      {
        labels: [
          { clusterId: 'cluster-1', label: 'Shoes', members: [uuid(99)] },
        ],
        citations: [],
      },
    ],
  ])('rejects the WHOLE response for %s', (_name, hostile) => {
    const clusters = fixtureClusters();
    expect(() => validateClusterLabelsAiOutput(hostile, clusters)).toThrow(
      KeywordClusterAiOutputContractError,
    );
  });
});

describe('applyClusterLabelsAiOutput', () => {
  it('attaches labels and leaves every other field untouched', () => {
    const clusters = fixtureClusters();
    const labelled = applyClusterLabelsAiOutput(
      validateClusterLabelsAiOutput(good, clusters),
      clusters,
    );
    expect(labelled.map((cluster) => [cluster.id, cluster.label, cluster.labelSource])).toEqual([
      ['cluster-1', 'Running shoes', 'ai'],
      ['cluster-2', 'Hiking boots', 'ai'],
      ['cluster-3', null, null],
    ]);
  });

  it('AI NEVER moves membership: the cluster array is byte-identical but for labels', () => {
    const clusters = fixtureClusters();
    const before = JSON.stringify(clusters);
    const labelled = applyClusterLabelsAiOutput(
      validateClusterLabelsAiOutput(good, clusters),
      clusters,
    );
    // Strip only the two label fields and the two arrays must match exactly.
    const stripped = labelled.map((cluster) => ({
      ...cluster,
      label: null,
      labelSource: null,
    }));
    expect(JSON.stringify(stripped)).toBe(before);
    expect(JSON.stringify(clusters)).toBe(before);
  });

  it('leaves a cluster the model did not name unlabeled', () => {
    const clusters = fixtureClusters();
    const labelled = applyClusterLabelsAiOutput(
      validateClusterLabelsAiOutput(
        { labels: [{ clusterId: 'cluster-2', label: 'Boots' }], citations: [] },
        clusters,
      ),
      clusters,
    );
    expect(labelled[0]!.label).toBeNull();
    expect(labelled[0]!.labelSource).toBeNull();
    expect(labelled[1]!.label).toBe('Boots');
  });
});
