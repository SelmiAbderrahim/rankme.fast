import { useLayoutEffect, useState } from 'react';

const SCROLLING = new Set(['auto', 'scroll', 'overlay']);

/** The nearest ancestor that scrolls on its own; `null` when the document scrolls. */
function findScroller(node: HTMLElement): HTMLElement | null {
  // The walk always ends at <body>, so a node with no scrolling ancestor is the
  // document-scrolls case.
  for (
    let parent = node.parentElement;
    parent && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    if (SCROLLING.has(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/**
 * Space that must stay below `node` inside `scroller`: the padding and border
 * of every ancestor up to the scroller, plus the height of everything that
 * follows `node` or its ancestors in flow (the shell's footer). Without it the
 * workspace fits the viewport but not its own page, and the column scrolls too.
 */
function reservedBelow(node: HTMLElement, scroller: HTMLElement): number {
  let reserved = 0;
  let child: HTMLElement = node;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    for (let sibling = child.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const style = getComputedStyle(sibling);
      if (style.display === 'none' || style.position === 'fixed' || style.position === 'absolute') continue;
      reserved += sibling.getBoundingClientRect().height;
    }
    const style = getComputedStyle(parent);
    reserved += (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    if (parent === scroller) break;
    child = parent;
  }
  return reserved;
}

export interface ViewportFillOptions {
  /** Space left under the node when the document scrolls (phones). */
  bottomGap?: number;
  /** The node never gets less than this, so its contents stay usable. */
  minHeight?: number;
}

/**
 * Height (px) that makes `node` end at the bottom of what the reader can see
 * while every scroll container above it is at the top.
 *
 * - Inside a scrolling app column (desktop/tablet) the column's own bottom is
 *   the edge, and the column's padding and footer are reserved, so the column
 *   has nothing left to scroll: the message log is the only scroll owner.
 * - On phones the document scrolls, and the edge is the *visual* viewport, which
 *   shrinks when the on-screen keyboard opens. The node's bottom edge then
 *   sits just above the browser chrome, so the composer is in the first view.
 *
 * Measured in document coordinates, so scrolling does not change the value;
 * re-measured on resize, visual-viewport changes and ancestor size changes
 * (for example the beta banner being dismissed). Returns `null` until measured.
 */
export function useViewportFillHeight(
  node: HTMLElement | null,
  { bottomGap = 8, minHeight = 0 }: ViewportFillOptions = {},
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!node) return undefined;
    const ancestors: HTMLElement[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      ancestors.push(parent);
    }
    const measure = () => {
      const scroller = findScroller(node);
      const top = ancestors.reduce(
        (offset, ancestor) => offset + ancestor.scrollTop,
        node.getBoundingClientRect().top + window.scrollY,
      );
      const edge = scroller
        ? scroller.getBoundingClientRect().bottom
        : (window.visualViewport?.height ?? window.innerHeight);
      const reserved = scroller ? reservedBelow(node, scroller) : bottomGap;
      setHeight(Math.max(minHeight, Math.floor(edge - top - reserved)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    ancestors.forEach((ancestor) => observer.observe(ancestor));
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [node, bottomGap, minHeight]);

  return height;
}
