import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from './index';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LocaleContextProvider } from './LocaleContext';

beforeEach(() => initI18n({ initialLocale: 'en' }));

it('returns to the current language when the switch fails', async () => {
  const changeLocale = vi.fn().mockRejectedValue(new Error('offline'));
  const onLocaleChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <LocaleContextProvider value={{ isSaving: false, changeLocale }}>
        <LanguageSwitcher onLocaleChange={onLocaleChange} />
      </LocaleContextProvider>
    </I18nextProvider>,
  );
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'de' } });
  await waitFor(() => expect(changeLocale).toHaveBeenCalledWith('de'));
  await waitFor(() => expect(select).not.toBeDisabled());
  expect(select.value).toBe('en');
  expect(onLocaleChange).not.toHaveBeenCalled();
});
