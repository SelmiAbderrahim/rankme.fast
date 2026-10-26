import { beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n, changeLanguage } from '@shared/i18n';
import { PasswordInput } from './PasswordInput';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
it('keeps password visibility local, keyboard accessible and resets it when focus leaves', async () => {
  const ref = { current: null as HTMLInputElement | null };
  const view = render(
    <>
      <label htmlFor="password">Password</label>
      <PasswordInput ref={ref} id="password" defaultValue="secret" />
      <button>Outside</button>
    </>,
  );
  expect(ref.current).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(ref.current).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.click(ref.current!);
  expect(ref.current).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(ref.current).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
  expect(ref.current).toHaveAttribute('type', 'password');
  view.rerender(<PasswordInput id="disabled" disabled />);
  expect(screen.getByRole('button')).toBeDisabled();
});
