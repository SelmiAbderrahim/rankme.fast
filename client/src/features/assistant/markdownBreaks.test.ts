import type { Root } from 'mdast';
import { describe, expect, it } from 'vitest';
import { remarkSoftBreaks } from './markdownBreaks';

const transform = (tree: Root): Root => {
  remarkSoftBreaks()(tree);
  return tree;
};

describe('remarkSoftBreaks', () => {
  it('splits newlines in text nodes into break nodes at any depth', () => {
    const tree = transform({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a  \r\n  b\nc' },
            { type: 'strong', children: [{ type: 'text', value: 'x\ny' }] },
          ],
        },
      ],
    });
    expect(tree.children[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'a' },
        { type: 'break' },
        { type: 'text', value: 'b' },
        { type: 'break' },
        { type: 'text', value: 'c' },
        {
          type: 'strong',
          children: [
            { type: 'text', value: 'x' },
            { type: 'break' },
            { type: 'text', value: 'y' },
          ],
        },
      ],
    });
  });

  it('drops empty segments, leaves leaf and code nodes alone', () => {
    const tree = transform({
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: '\nlead' }] },
        { type: 'code', value: 'keep\nthis' },
        { type: 'thematicBreak' },
      ],
    });
    expect(tree.children).toEqual([
      { type: 'paragraph', children: [{ type: 'break' }, { type: 'text', value: 'lead' }] },
      { type: 'code', value: 'keep\nthis' },
      { type: 'thematicBreak' },
    ]);
  });
});
