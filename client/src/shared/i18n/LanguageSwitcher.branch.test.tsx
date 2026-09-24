import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

// Force the switcher's `isSupportedLocale` guard to report false so the
// current-locale expression falls through to its `: 'en'` arm even though the
// live i18n instance resolves to a supported language.
vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index');
  return { ...actual, isSupportedLocale: () => false };
});

describe('LanguageSwitcher unsupported-resolved-language fallback', () => {
  it('defaults the select to en when the resolved language is not supported', async () => {
    const { initI18n, i18n } = await import('./index');
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    initI18n({ initialLocale: 'de' });
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    const select = (await screen.findByLabelText(/./)) as HTMLSelectElement;
    expect(select.value).toBe('en');
    fireEvent.change(select, { target: { value: 'ar' } });
    expect(select.value).toBe('en');
  });
});
