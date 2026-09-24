/**
 * Hostile-content proof. Review text, titles, author names and
 * theme excerpts are untrusted vendor content. Fixtures carry a script tag,
 * every spreadsheet formula prefix, and a Unicode RTL override; the rendered
 * DOM must contain no `<script>`, the CSV must contain no executable prefix,
 * and the override character must not escape the tab's own `dir` scope.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { neutralizeExportCell } from '@shared/security';
import { ReviewInventoryTable } from './components/ReviewInventoryTable';
import { ReviewThemeCards } from './components/ReviewThemeCards';
import { clampExcerpt } from './components/ReviewThemeCards';
import { buildReviewCsv } from './csv';
import { localSeoReviewsReducer } from './store/slice';
import { REVIEW_THEME_EXCERPT_MAX_CHARS } from './types';
import {
  FORMULA_PAYLOADS,
  RTL_OVERRIDE_PAYLOAD,
  SCRIPT_PAYLOAD,
  inventoryResponse,
  reviewRow,
  reviewThemes,
} from './__fixtures__/reviews';

const renderNode = (node: React.ReactNode) =>
  render(
    <Provider store={configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } })}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

const hostileRows = [
  reviewRow({ id: 'row-script', text: SCRIPT_PAYLOAD, title: SCRIPT_PAYLOAD }),
  reviewRow({ id: 'row-rtl', text: RTL_OVERRIDE_PAYLOAD, authorDisplayName: RTL_OVERRIDE_PAYLOAD }),
  ...FORMULA_PAYLOADS.map((payload, index) =>
    reviewRow({ id: `row-formula-${index}`, text: payload, authorDisplayName: payload }),
  ),
];

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('hostile review content stays inert', () => {
  it('renders a script payload as text, never as markup', () => {
    const { container } = renderNode(
      <ReviewInventoryTable
        profileId="site-1"
        filters={{ page: 1 }}
        data={inventoryResponse({ reviews: hostileRows, total: hostileRows.length })}
        status="succeeded"
        error=""
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getAllByText(SCRIPT_PAYLOAD).length).toBeGreaterThan(0);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('keeps the RTL override inside the row, not in a document-level dir flip', () => {
    const { container } = renderNode(
      <ReviewInventoryTable
        profileId="site-1"
        filters={{ page: 1 }}
        data={inventoryResponse({ reviews: hostileRows, total: hostileRows.length })}
        status="succeeded"
        error=""
      />,
    );
    const row = screen.getByTestId('reviews-row-row-rtl');
    expect(row).toHaveTextContent(RTL_OVERRIDE_PAYLOAD);
    // Radix primitives may add their own valid direction attributes, but the
    // hostile payload never becomes direction metadata.
    expect(
      [...container.querySelectorAll('[dir]')].every((element) =>
        ['ltr', 'rtl'].includes(element.getAttribute('dir') ?? ''),
      ),
    ).toBe(true);
    expect(document.documentElement.dir).not.toBe('rtl');
  });

  it.each(FORMULA_PAYLOADS)('neutralizes the %j formula prefix in the CSV', (payload) => {
    const csv = buildReviewCsv([reviewRow({ text: payload, authorDisplayName: payload })]);
    expect(neutralizeExportCell(payload)).toBe(`'${payload}`);
    // Every data cell that carried the payload is prefixed; no bare cell
    // boundary is immediately followed by a formula character.
    for (const line of csv.split('\r\n').slice(1)) {
      for (const cell of line.split(',')) {
        expect(cell.replace(/^"/, '')).not.toMatch(/^[\t\r]|^\s*[=+\-@]/);
      }
    }
  });

  it('quotes and escapes a script payload inside the CSV without executing anything', () => {
    const csv = buildReviewCsv([reviewRow({ text: `"${SCRIPT_PAYLOAD}",=cmd` })]);
    expect(csv).toContain('""<script>window.__pwned = 1;</script>Great coffee"",=cmd');
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('renders a hostile theme excerpt as clamped text', () => {
    const hostile = reviewThemes({
      complaintThemes: [
        {
          label: SCRIPT_PAYLOAD,
          summary: RTL_OVERRIDE_PAYLOAD,
          citedReviewIds: ['g-1', 'g-2'],
          citations: [
            {
              reviewId: 'row-g-1',
              sourceReviewId: 'g-1',
              source: 'google',
              rating: 1,
              reviewedAt: null,
              excerpt: SCRIPT_PAYLOAD,
            },
            {
              reviewId: 'row-g-2',
              sourceReviewId: 'g-2',
              source: 'google',
              rating: 1,
              reviewedAt: null,
              excerpt: 'x'.repeat(REVIEW_THEME_EXCERPT_MAX_CHARS + 120),
            },
          ],
        },
      ],
      praiseThemes: [],
    });
    const { container } = renderNode(
      <ReviewThemeCards themes={hostile} status="succeeded" error="" inventoryHref="#x" />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('reviews-theme-complaint-0')).toHaveTextContent(SCRIPT_PAYLOAD);
  });

  it('clamps an over-long excerpt to the 300-character contract', () => {
    expect(clampExcerpt('y'.repeat(500))).toHaveLength(REVIEW_THEME_EXCERPT_MAX_CHARS);
    expect(clampExcerpt('short')).toBe('short');
  });
});
