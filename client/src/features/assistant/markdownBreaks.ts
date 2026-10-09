import type { Break, Nodes, Parent, PhrasingContent, Root, Text } from 'mdast';

/**
 * Chat replies put "Rule: …", "Severity: …" on separate lines and expect them
 * to stay separate, but CommonMark folds a single newline into a space. This is
 * a tiny local stand-in for `remark-breaks`: every newline inside a text node
 * becomes a `break` node, which react-markdown renders as a `<br>` element.
 * Only AST nodes are created — no HTML string ever exists — and `code` /
 * `inlineCode` nodes are not `text`, so fenced blocks keep their own newlines.
 */
const NEWLINES = /[ \t]*\r?\n[ \t]*/;

function splitText(node: Text): PhrasingContent[] {
  const pieces = node.value.split(NEWLINES);
  const out: PhrasingContent[] = [];
  pieces.forEach((value, index) => {
    if (index > 0) out.push({ type: 'break' } satisfies Break);
    if (value !== '') out.push({ type: 'text', value });
  });
  return out;
}

function breakLines(parent: Parent): void {
  const next: Nodes[] = [];
  for (const child of parent.children) {
    if (child.type === 'text') {
      next.push(...splitText(child));
      continue;
    }
    if ('children' in child) breakLines(child);
    next.push(child);
  }
  parent.children = next as Parent['children'];
}

export function remarkSoftBreaks() {
  return (tree: Root): void => {
    breakLines(tree);
  };
}
