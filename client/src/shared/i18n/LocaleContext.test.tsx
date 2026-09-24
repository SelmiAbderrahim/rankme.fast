import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';
import { changeLanguage, i18n, initI18n } from './index';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('locale context fallback', () => {
  it('keeps unauthenticated switchers immediate outside a provider', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ar' } });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ar'));
    expect(document.documentElement.dir).toBe('rtl');
  });
});
