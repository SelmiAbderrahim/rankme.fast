import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AddKeywordForm } from './components/AddKeywordForm';
import { buildLongTailResearchUrl, longTailResearchSeed } from './validation';

vi.mock('./api', () => ({
  fetchKeywordSuggestionsRequest: vi.fn(),
  previewAltEngineKeywordRequest: vi.fn().mockResolvedValue({}),
}));

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => ({
    markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['en'] }],
    loading: false,
    error: false,
  }),
}));

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('long-tail research handoff', () => {
  it('accepts one Google phrase and carries it in the URL', () => {
    const seed = longTailResearchSeed('best shoes for rain', 'google');
    expect(seed).toBe('best shoes for rain');

    const url = buildLongTailResearchUrl('site-1', seed!, 2826, 'en');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/sites/site-1?')).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      tab: 'research',
      seed: 'best shoes for rain',
      location: '2826',
      lang: 'en',
    });
  });

  it('rejects multiple, overlong, and non-Google phrases', () => {
    expect(longTailResearchSeed('one\ntwo', 'google')).toBeNull();
    expect(longTailResearchSeed('one, two', 'google')).toBeNull();
    expect(longTailResearchSeed('x'.repeat(81), 'google')).toBeNull();
    expect(longTailResearchSeed('one', 'bing')).toBeNull();
  });

  it('enables the link for one Google phrase only', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AddKeywordForm
            siteId="site-1"
            onSubmit={vi.fn().mockResolvedValue([])}
            submitting={false}
            addError=""
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('keyword-long-tail-research-disabled')).toBeDisabled();
    await user.type(screen.getByLabelText('Keywords'), 'best shoes for rain');
    const link = screen.getByTestId('keyword-long-tail-research-link');
    const params = new URLSearchParams(link.getAttribute('href')?.split('?')[1]);
    expect(params.get('seed')).toBe('best shoes for rain');

    await user.type(screen.getByLabelText('Keywords'), '{enter}second phrase');
    expect(screen.getByTestId('keyword-long-tail-research-disabled')).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Bing/i }));
    expect(screen.queryByTestId('keyword-long-tail-research')).not.toBeInTheDocument();
  });
});
