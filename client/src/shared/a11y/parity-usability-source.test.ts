import { describe, expect, it } from 'vitest';

type RawModule = { default: string };
type SourceCase = readonly [name: string, load: () => Promise<RawModule>];

const TABLE_SOURCES: SourceCase[] = [
  ['BacklinksPanel', () => import('../../features/backlinks/components/BacklinksPanel.tsx?raw')],
  ['DeepPullViews', () => import('../../features/backlinks/components/DeepPullViews.tsx?raw')],
  ['GapWorkspace', () => import('../../features/backlinks/components/GapWorkspace.tsx?raw')],
  ['HistoryChart', () => import('../../features/backlinks/components/HistoryChart.tsx?raw')],
  [
    'SnapshotDetail',
    () => import('../../features/competitors/traffic/components/SnapshotDetail.tsx?raw'),
  ],
  [
    'SnapshotList',
    () => import('../../features/competitors/traffic/components/SnapshotList.tsx?raw'),
  ],
  [
    'HistorySparkline',
    () => import('../../features/competitors/traffic/components/HistorySparkline.tsx?raw'),
  ],
  [
    'TrafficCompareChart',
    () => import('../../features/competitors/traffic/components/TrafficCompareChart.tsx?raw'),
  ],
  [
    'TrafficCompareView',
    () => import('../../features/competitors/traffic/components/TrafficCompareView.tsx?raw'),
  ],
  [
    'LiveTrendsView',
    () => import('../../features/keyword-research/components/LiveTrendsView.tsx?raw'),
  ],
  [
    'ReviewInventoryTable',
    () => import('../../features/local-seo/reviews/components/ReviewInventoryTable.tsx?raw'),
  ],
  [
    'ReviewRunList',
    () => import('../../features/local-seo/reviews/components/ReviewRunList.tsx?raw'),
  ],
  [
    'ReviewTrendChart',
    () => import('../../features/local-seo/reviews/components/ReviewTrendChart.tsx?raw'),
  ],
  ['ScanListTable', () => import('../../features/brand-radar/components/ScanListTable.tsx?raw')],
  ['MentionTable', () => import('../../features/brand-radar/components/MentionTable.tsx?raw')],
  ['SentimentBar', () => import('../../features/brand-radar/components/SentimentBar.tsx?raw')],
  ['TrendSparkline', () => import('../../features/brand-radar/components/TrendSparkline.tsx?raw')],
];

describe('batch screen-reader source contracts', () => {
  it.each(TABLE_SOURCES)('%s gives every data table a caption', async (_name, load) => {
    const source = (await load()).default;
    const tables = source.match(/<(?:Table|table)(?=[\s>])/g)?.length ?? 0;
    const captions = source.match(/<(?:TableCaption|caption)(?=[\s>])/g)?.length ?? 0;
    expect(tables).toBeGreaterThan(0);
    expect(captions).toBe(tables);
  });

  it('gives shared column headers scope', async () => {
    const table = (await import('../ui/table.tsx?raw')).default;

    expect(table).toContain('scope = "col"');
    expect(table).toContain('scope={scope}');
  });
});

describe('reduced-motion source contracts', () => {
  it('terminates spinners and chart motion', async () => {
    const [spinner, sonner, history] = await Promise.all([
        import('../ui/spinner.tsx?raw'),
        import('../ui/sonner.tsx?raw'),
        import('../../features/backlinks/components/HistoryChart.tsx?raw'),
    ]);

    expect(spinner.default).toContain('motion-reduce:animate-none');
    expect(sonner.default).toContain('motion-reduce:animate-none');
    expect(history.default).toContain('data-motion="static"');
    expect(history.default).toContain('motion-reduce:transition-none');
  });
});

describe('shared-component logical layout guard', () => {
  it('keeps sweep-touched shared primitives free of physical margin and text utilities', async () => {
    const sources = await Promise.all([
      import('../ui/table.tsx?raw'),
      import('../ui/stat-card.tsx?raw'),
      import('../ui/spinner.tsx?raw'),
      import('../ui/sonner.tsx?raw'),
    ]);
    const physical = /(?:^|[\s"'`])(?:ml-|mr-|text-left\b|text-right\b)/;
    for (const source of sources) {
      expect(source.default).not.toMatch(physical);
    }
  });
});
