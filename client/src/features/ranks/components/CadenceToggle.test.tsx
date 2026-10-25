import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { CadenceToggle } from './CadenceToggle';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('rank check cadence', () => {
  it('labels the switch by the schedule it enables and states the current cadence', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<I18nextProvider i18n={i18n}>
      <CadenceToggle cadence="weekly" onChange={onChange} />
    </I18nextProvider>);
    const toggle = screen.getByRole('switch', { name: 'Daily checks' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('cadence-toggle-state')).toHaveTextContent('Weekly');
    expect(screen.getByTestId('cadence-toggle-help')).toHaveTextContent('once a week');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith('daily');
    rerender(<I18nextProvider i18n={i18n}>
      <CadenceToggle cadence="daily" onChange={onChange} />
    </I18nextProvider>);
    expect(toggle).toBeChecked();
    expect(screen.getByTestId('cadence-toggle-state')).toHaveTextContent('Daily');
    expect(screen.getByTestId('cadence-toggle-help')).toHaveTextContent('every morning');
    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith('weekly');
  });

  it('keeps a disabled schedule switch unavailable', () => {
    render(<I18nextProvider i18n={i18n}>
      <CadenceToggle cadence="weekly" disabled onChange={vi.fn()} />
    </I18nextProvider>);
    expect(screen.getByRole('switch', { name: 'Daily checks' })).toBeDisabled();
  });
});
