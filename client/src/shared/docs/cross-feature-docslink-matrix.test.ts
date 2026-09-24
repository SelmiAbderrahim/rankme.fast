import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { DOCS_SLUGS, type DocsSlug } from './docsUrl';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, '..', '..');

// Every feature workspace that carries a
// customer-facing "how do I use this?" surface anchors a DocsLink pointing at
// its docs page. This matrix regression asserts the DocsLink is still there;
// deletions here must be intentional (and paired with a docs-slug retirement).
const CROSS_FEATURE_DOCSLINK_MATRIX: ReadonlyArray<{
  feature: string;
  file: string;
  slug: DocsSlug;
}> = [
  {
    feature: 'report',
    file: 'features/report/components/ReportPage.tsx',
    slug: 'audit-report',
  },
  {
    feature: 'report / ai-summary',
    file: 'features/report/components/AiSummaryCard.tsx',
    slug: 'ai-summary',
  },
  {
    feature: 'google-connections',
    file: 'features/google/components/GoogleConnectionCard.tsx',
    slug: 'google-search-console',
  },
  {
    feature: 'settings / API keys',
    file: 'features/settings/components/ApiKeysPanel.tsx',
    slug: 'rankmefast-mcp',
  },
  {
    feature: 'AI Assistant',
    file: 'features/assistant/components/AssistantPage.tsx',
    slug: 'ai-assistant',
  },
  // New roadmap workspaces anchor their docs pages.
  {
    feature: 'audience-research',
    file: 'features/audience-research/components/AudienceResearchPanel.tsx',
    slug: 'audience-research',
  },
  {
    feature: 'keyword-research / intelligence workspace',
    file: 'features/keyword-research/components/KeywordIntelligenceWorkspace.tsx',
    slug: 'keyword-intelligence',
  },
  {
    feature: 'link-intelligence',
    file: 'features/backlinks/components/BacklinksWorkspace.tsx',
    slug: 'link-intelligence',
  },
  {
    feature: 'traffic-insights',
    file: 'features/competitors/traffic/components/TrafficInsightsPanel.tsx',
    slug: 'traffic-insights',
  },
  {
    feature: 'keyword-trends standalone',
    file: 'features/keyword-research/components/KeywordLiveTrendsPage.tsx',
    slug: 'keyword-trends',
  },
  {
    feature: 'keyword-trends workspace',
    file: 'features/keyword-research/components/KeywordIntelligenceWorkspace.tsx',
    slug: 'keyword-trends',
  },
  {
    feature: 'review-intelligence',
    file: 'features/local-seo/reviews/components/ReviewsPanel.tsx',
    slug: 'review-intelligence',
  },
  {
    feature: 'brand-radar',
    file: 'features/brand-radar/components/BrandRadarPage.tsx',
    slug: 'brand-radar',
  },
];

describe('cross-feature DocsLink matrix (placement)', () => {
  it.each(CROSS_FEATURE_DOCSLINK_MATRIX)(
    '$feature still carries DocsLink slug="$slug"',
    ({ file, slug }) => {
      const src = readFileSync(resolve(CLIENT_SRC, file), 'utf8');
      expect(src, `expected DocsLink import in ${file}`).toMatch(
        /import\s*\{\s*DocsLink\s*\}\s*from\s+['"]@shared\/docs\/DocsLink['"]/,
      );
      const pattern = new RegExp(
        String.raw`<DocsLink[^/>]*\bslug\s*=\s*['"]${slug}['"]`,
      );
      expect(src, `expected <DocsLink slug="${slug}"/> in ${file}`).toMatch(pattern);
    },
  );

  it('every slug in the matrix is a valid DocsSlug', () => {
    for (const row of CROSS_FEATURE_DOCSLINK_MATRIX) {
      expect(DOCS_SLUGS as readonly string[]).toContain(row.slug);
    }
  });
});
