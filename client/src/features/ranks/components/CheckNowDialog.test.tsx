import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { CheckNowDialog } from './CheckNowDialog';

beforeEach(() => initI18n({ initialLocale: 'en' }));

const mount = (confirming: boolean) => {
  const onCancel = vi.fn();
  render(<I18nextProvider i18n={i18n}>
    <CheckNowDialog open target={{ scope: 'site' }} confirming={confirming} onConfirm={vi.fn()} onCancel={onCancel} />
  </I18nextProvider>);
  return onCancel;
};

it('cancels on Escape before a check is requested', async () => {
  const onCancel = mount(false);
  await userEvent.setup().keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('stays open while the request is being sent', async () => {
  const onCancel = mount(true);
  await userEvent.setup().keyboard('{Escape}');
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByTestId('check-now-dialog')).toBeInTheDocument();
});
