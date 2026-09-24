export interface TableOfContentsItem {
  id: string;
  label: string;
  level: 2 | 3;
}

export function nodeText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(children)) return nodeText(children.props.children);
  return '';
}

export function headingId(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export function tableOfContents(markdown: string): TableOfContentsItem[] {
  return markdown
    .split('\n')
    .flatMap((line): TableOfContentsItem[] => {
      const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
      if (!match) return [];
      const label = match[2]!.replace(/[*_`]/g, '').trim();
      return label
        ? [{ id: headingId(label), label, level: match[1] === '##' ? 2 : 3 }]
        : [];
    });
}

export function markdownDocsSlug(href: string): string | undefined {
  const match = /^(?:\.\/)?([a-z0-9-]+)(?:\.(?:en|ar|fr|de|es|ru|zh))?\.md(?:#.*)?$/.exec(href);
  return match?.[1];
}
import { isValidElement, type ReactNode } from 'react';
