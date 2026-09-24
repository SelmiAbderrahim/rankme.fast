import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useTabParam } from './useTabParam';

const TABS = ['overview', 'members', 'security'] as const;
type Tab = (typeof TABS)[number];

const Harness = () => {
  const [tab] = useTabParam<Tab>('overview', TABS);
  return <span data-testid="tab-value">{tab}</span>;
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/x${search}`]}>
      <Routes>
        <Route path="/x" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );

// The URL-state contract (rules/url-tab-state.md) says invalid values MUST
// fall back to the default. The practical impact
// of that contract is a Reflected-XSS invariant: a crafted deep link may put
// arbitrary text in `?tab=` — the renderer must NEVER echo that raw string
// into the DOM. It must render the canonical enum value or the default.
describe('reflected-XSS invariant on tab/view URL state', () => {
  const HOSTILE_PAYLOADS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    `'></span><script>alert(1)</script><span>`,
    'javascript:alert(1)',
    'members<script>alert(1)</script>',
  ];

  it.each(HOSTILE_PAYLOADS)(
    'a hostile ?tab=%s deep link falls back to the canonical default and never reflects raw',
    (payload) => {
      renderAt(`?tab=${encodeURIComponent(payload)}`);
      const rendered = screen.getByTestId('tab-value').textContent ?? '';
      // Must render the canonical default, not the payload.
      expect(rendered).toBe('overview');
      // Belt-and-braces: no HTML tag or javascript: scheme ever reaches the DOM
      // text node for this value.
      expect(rendered).not.toContain('<');
      expect(rendered).not.toContain('>');
      expect(rendered.toLowerCase()).not.toContain('script');
      expect(rendered.toLowerCase()).not.toContain('javascript:');
    },
  );

  it('a valid enum value still passes through unchanged', () => {
    renderAt('?tab=members');
    expect(screen.getByTestId('tab-value').textContent).toBe('members');
  });
});
