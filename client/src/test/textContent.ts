import type { MatcherFunction } from '@testing-library/react';

const withoutIsolation = (element: Element | null) => (element?.textContent ?? '').replace(/[\u2068\u2069]/g, '');

/** Match the deepest whole-text node, including nested bidi isolates. */
export const textContentMatcher = (expected: string | RegExp): MatcherFunction => (_content, element) => {
  const matches = (node: Element) => {
    const text = withoutIsolation(node);
    if (typeof expected === 'string') return text === expected;
    const previousIndex = expected.lastIndex;
    expected.lastIndex = 0;
    const result = expected.test(text);
    expected.lastIndex = previousIndex;
    return result;
  };
  return element !== null && matches(element) && Array.from(element.children).every((child) => !matches(child));
};

export const visibleText = (element: Element | null): string => withoutIsolation(element).replace(/\s+/g, ' ').trim();
