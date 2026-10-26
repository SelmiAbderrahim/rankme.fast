import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bdi } from './Bdi';

describe('bidirectional content', () => {
  it.each([
    ['تطبيق السعودية (Saudi rewards app)', ['(Saudi rewards app)']],
    ['Shopping rewards (مكافآت التسوق)', ['(مكافآت التسوق)']],
    ['(first) (ثاني) (outer (inner) tail)', ['(first)', '(ثاني)', '(inner)']],
    ['(27) (−75) (+2) (١١)', []],
    ['<script>alert(1)</script> <img src=x onerror=alert(1)>', []],
    ['unmatched (unfinished', []],
  ] as const)('preserves text and isolates parenthetical words: %s', (text, expected) => {
    render(<Bdi data-testid="value" className="truncate">{text}</Bdi>);
    const root = screen.getByTestId('value');
    expect(root.tagName).toBe('BDI');
    expect(root).toHaveAttribute('dir', 'auto');
    expect(root).toHaveClass('truncate');
    expect(root.textContent).toBe(text);
    expect([...root.querySelectorAll('span')].map((node) => node.textContent)).toEqual(expected);
    for (const node of root.querySelectorAll('span')) expect(node).toHaveStyle({ unicodeBidi: 'isolate' });
    expect(root.querySelector('script, img')).toBeNull();
  });

  it('supports dominant direction, React children and empty translation slots', () => {
    render(<><Bdi dominant data-testid="rtl">EpisodeBrief · كيف يعمل EpisodeBrief؟</Bdi><Bdi dominant data-testid="ltr">An English title</Bdi><Bdi dominant data-testid="node"><strong>Original (node)</strong></Bdi><Bdi data-testid="number">{27}</Bdi><Bdi data-testid="empty" /></>);
    expect(screen.getByTestId('rtl')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('ltr')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('node')).toHaveAttribute('dir', 'auto');
    expect(screen.getByTestId('node').querySelector('strong')).toHaveTextContent('Original (node)');
    expect(screen.getByTestId('number')).toHaveTextContent('27');
    expect(screen.getByTestId('empty')).toBeEmptyDOMElement();
  });
});
