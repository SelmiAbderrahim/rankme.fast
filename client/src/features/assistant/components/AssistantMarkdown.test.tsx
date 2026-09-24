/**
 * Assistant replies are untrusted model output rendered as markdown. Two
 * contracts are covered here:
 *
 * 1. Every element the renderer overrides actually renders — headings, lists,
 *    tables, code, quotes, rules, links and images.
 * 2. SEC-OUT (`.claude/rules/output-encoding.md`) — that output can never
 *    become live markup: no raw HTML, no unsafe scheme, no remote image, and
 *    no `dangerouslySetInnerHTML` / `rehype-raw` anywhere in the feature.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from './AssistantMarkdown';

const FEATURE_DIR = path.resolve(__dirname, '..');

/** Every source file this feature ships (tests excluded). */
function featureSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      files.push(full);
    }
  };
  walk(FEATURE_DIR);
  return files;
}

const FIXTURE = [
  '# Fix now',
  '',
  '## Missing H1',
  '',
  '### Sitemap',
  '',
  '#### Canonical',
  '',
  '##### Meta description',
  '',
  '###### Structured data',
  '',
  'Your homepage has **no H1 tag** and needs `<title>` review.',
  '',
  '- Compress large images',
  '- Defer unused JavaScript',
  '',
  '1. Publish a sitemap',
  '2. Point robots.txt at it',
  '',
  '> Lab estimate, not field data.',
  '',
  '| Issue | What to do |',
  '| --- | --- |',
  '| Low page speed | Compress images |',
  '',
  '```',
  'Sitemap: https://cashback.sa/sitemap.xml',
  '```',
  '',
  '---',
  '',
  '[Rich Results Test](https://search.google.com/test/rich-results)',
  '',
  '![Audit chart](https://evil.example/chart.png)',
].join('\n');

describe('AssistantMarkdown', () => {
  it('renders every supported markdown block', () => {
    const { container } = render(<AssistantMarkdown text={FIXTURE} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fix now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Missing H1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sitemap' })).toBeInTheDocument();
    // h4–h6 share the h3 renderer, so they render as level-3 headings.
    expect(screen.getByRole('heading', { level: 3, name: 'Canonical' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Meta description' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Structured data' })).toBeInTheDocument();

    expect(screen.getByText('no H1 tag').tagName).toBe('STRONG');
    expect(screen.getByText('<title>').tagName).toBe('CODE');

    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelector('ol')).not.toBeNull();
    expect(screen.getByText('Lab estimate, not field data.').closest('blockquote')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();

    expect(screen.getByRole('columnheader', { name: 'Issue' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Low page speed' })).toBeInTheDocument();

    const pre = container.querySelector('pre');
    expect(pre).toHaveTextContent('Sitemap: https://cashback.sa/sitemap.xml');
    expect(pre?.className).toContain('overflow-x-auto');
  });

  it('opens external links through the shared scheme guard', () => {
    render(<AssistantMarkdown text={FIXTURE} />);
    const link = screen.getByRole('link', { name: 'Rich Results Test' });
    expect(link).toHaveAttribute('href', 'https://search.google.com/test/rich-results');
    expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('neutralizes unsafe link schemes', () => {
    render(<AssistantMarkdown text={'[Click me](javascript:alert(1))'} />);
    expect(screen.getByRole('link', { name: 'Click me' })).toHaveAttribute('href', '#');
  });

  it('renders image alt text instead of a blocked remote image', () => {
    const { container } = render(<AssistantMarkdown text={FIXTURE} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Audit chart')).toBeInTheDocument();
  });

  it('keeps embedded HTML inert', () => {
    const { container } = render(
      <AssistantMarkdown text={'Before <script>alert(1)</script> <b>bold</b> after'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('SEC-OUT — assistant output never becomes markup', () => {
  it('no feature source uses dangerouslySetInnerHTML or rehype-raw', () => {
    const offenders = featureSources().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('dangerouslySetInnerHTML') || source.includes('rehype-raw');
    });
    expect(offenders).toEqual([]);
  });

  it('no feature source uses a physical directional utility', () => {
    // Logical utilities only (`ms-*` / `ps-*` / `text-start`); a physical
    // margin or padding would leak under Arabic.
    const physical = /className="[^"]*\b(?:ml|mr|pl|pr)-\d|text-(?:left|right)\b/;
    const offenders = featureSources().filter((file) =>
      physical.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
