import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

const renderToggle = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </I18nextProvider>,
  );

const pickOption = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /toggle theme/i }));
  const menu = await screen.findByRole('menu');
  await user.click(within(menu).getByText(name));
};

describe('ThemeToggle', () => {
  it('exposes the active preference through radio-menu semantics', async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('selecting Dark applies the dark class and persists it', async () => {
    renderToggle();
    await pickOption('Dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('selecting Light removes the dark class', async () => {
    renderToggle();
    await pickOption('Dark');
    await pickOption('Light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('selecting System persists the system preference', async () => {
    renderToggle();
    await pickOption('System');
    expect(window.localStorage.getItem('theme')).toBe('system');
  });
});
