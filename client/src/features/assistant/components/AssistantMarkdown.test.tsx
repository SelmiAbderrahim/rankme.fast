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
import { AssistantMarkdown, hideInternalIds } from './AssistantMarkdown';

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
  'Sitemap: https://rewards.example.sa/sitemap.xml',
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

    // Every reply heading is an h3 under the page h1 and the log h2, so a model "# Title" never adds a second h1; sizes follow the source level.
    expect(screen.getByRole('heading', { level: 3, name: 'Fix now' })).toHaveClass('text-base');
    expect(screen.getByRole('heading', { level: 3, name: 'Missing H1' })).toHaveClass('text-sm', 'text-foreground');
    expect(screen.getByRole('heading', { level: 3, name: 'Sitemap' })).toHaveClass('text-muted-foreground');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
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
    expect(pre).toHaveTextContent('Sitemap: https://rewards.example.sa/sitemap.xml');
    expect(pre?.className).toContain('overflow-x-auto');
  });

  it('keeps wide tables and long words inside the bubble', () => {
    const { container } = render(
      <AssistantMarkdown
        text={'| Site | URL | Created | Status | Pages |\n| --- | --- | --- | --- | --- |\n| Episode Brief | https://episodebrief.com | 2026-09-01 | active | 42 |\n\nsupercalifragilisticexpialidocious-content-analysis'}
      />,
    );
    // The table scrolls horizontally in its own bounded wrapper and keeps word
    // wrapping normal, so columns are not crushed to one character wide.
    const table = container.querySelector('table')!;
    expect(table.parentElement).toHaveClass('max-w-full', 'overflow-x-auto');
    // Keyboard users can focus the scroll region to scroll it.
    expect(table.parentElement).toHaveAttribute('tabindex', '0');
    expect(table.parentElement).toHaveAttribute('data-slot', 'assistant-table-scroll');
    expect(table).toHaveClass('[overflow-wrap:normal]');
    // Prose may break anywhere, so a long token wraps instead of being clipped.
    expect(container.firstElementChild).toHaveClass('min-w-0', '[overflow-wrap:anywhere]');
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

  it('renders single newlines as line breaks and keeps code blocks intact', () => {
    const { container } = render(
      <AssistantMarkdown
        text={[
          'Rule: Page titles missing or weak',
          'Severity: Warning',
          'Affected URL: https://example.com/',
          '',
          '- first line',
          '  second line',
          '',
          '```',
          'keep',
          'newlines',
          '```',
        ].join('\n')}
      />,
    );
    const paragraph = container.querySelector('p')!;
    expect(paragraph.querySelectorAll('br')).toHaveLength(2);
    expect(paragraph.innerHTML).toContain('Severity: Warning');
    expect(container.querySelector('li br')).not.toBeNull();
    // No line break element is injected into the fenced block.
    expect(container.querySelector('pre br')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toBe('keep\nnewlines\n');
  });

  it('does not turn a break-containing line into HTML', () => {
    const { container } = render(
      <AssistantMarkdown text={'a <img src=x onerror=alert(1)>\nb'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('treats bare domains the same way in every table row', () => {
    render(
      <AssistantMarkdown
        text={[
          '| Site |',
          '| --- |',
          '| www.example.com |',
          '| example.com |',
          '| https://full.example.com/path |',
          '',
          '[www.label.com](https://www.label.com/page)',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('cell', { name: 'www.example.com' }).querySelector('a')).toBeNull();
    expect(screen.getByRole('cell', { name: 'example.com' }).querySelector('a')).toBeNull();
    // Full URLs and explicit links keep working through the safe-href guard.
    const full = screen.getByRole('link', { name: 'https://full.example.com/path' });
    expect(full).toHaveAttribute('href', 'https://full.example.com/path');
    expect(full).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(screen.getByRole('link', { name: 'www.label.com' })).toHaveAttribute(
      'href',
      'https://www.label.com/page',
    );
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

describe('internal ids never reach the reader', () => {
  const RUN_ID = '6a7b5c38a1b2c3d4e5f60718';
  const DIGEST = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

  it.each([
    ['audit 6a7b5c38a… (Aug 11) found two issues', 'audit (Aug 11) found two issues'],
    ['audit 6a7b5c38a... (Aug 11)', 'audit (Aug 11)'],
    [`Run ${RUN_ID} finished, then it stopped.`, 'Run finished, then it stopped.'],
    [`Action ${DIGEST}, which is open`, 'Action, which is open'],
    [`(${RUN_ID})`, '()'],
  ])('removes a stand-alone id from "%s"', (input, expected) => {
    expect(hideInternalIds(input)).toBe(expected);
  });

  it.each([
    // Links and paths that carry an id keep working.
    `[the report](/sites/${RUN_ID}/report/${RUN_ID})`,
    `https://app.example.test/sites/x?runId=${RUN_ID}`,
    `see /sites/${RUN_ID}`,
    // Ordinary text and numbers are never touched.
    'Your site ranks #46 for "KSA shopping rewards app" since 2026-10-12.',
    'Version 2026101412 shipped with 12345678 impressions.',
    'A decade-old facade added dead links.',
    'abcdefabcdef is letters only',
    '123456789012 is digits only',
  ])('leaves "%s" alone', (input) => {
    expect(hideInternalIds(input)).toBe(input);
  });

  it('applies to rendered assistant replies and keeps the links', () => {
    render(
      <AssistantMarkdown
        text={`Audit ${RUN_ID} is [here](https://example.com/report/${RUN_ID}).`}
      />,
    );
    expect(screen.getByText(/^Audit is/).textContent).toBe('Audit is here.');
    expect(screen.getByRole('link', { name: 'here' })).toHaveAttribute(
      'href',
      `https://example.com/report/${RUN_ID}`,
    );
  });
});
