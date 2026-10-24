import { useState } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n, changeLanguage } from '@shared/i18n';
import { DatePicker, type DatePickerProps } from './DatePicker';
const NOW = Date.parse('2026-10-07T12:00:00Z');
function Harness({
  initial = '2026-10-05',
  onChange = vi.fn(),
  ...props
}: Partial<DatePickerProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label id="from-label" htmlFor="from">
        From
      </label>
      <DatePicker
        id="from"
        labelId="from-label"
        data-testid="from"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        {...props}
      />
    </>
  );
}
const focused = () => document.activeElement?.getAttribute('data-date');
const open = async () => {
  await userEvent.click(screen.getByTestId('from'));
  return screen.findByRole('dialog');
};
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
afterEach(() => vi.useRealTimers());
it('selects dates, clears values, picks today and names its trigger', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByTestId('from')).toHaveAccessibleName(/From/);
  let dialog = await open();
  expect(dialog).toHaveAccessibleName('Choose a date');
  await waitFor(() => expect(focused()).toBe('2026-10-05'));
  await userEvent.click(dialog.querySelector('[data-date="2026-10-12"]')!);
  expect(onChange).toHaveBeenLastCalledWith('2026-10-12');
  dialog = await open();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Today' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-07');
  dialog = await open();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(screen.getByTestId('from')).toHaveTextContent('Pick a date');
  dialog = await open();
  expect(within(dialog).queryByRole('button', { name: 'Clear' })).toBeNull();
});
it('moves through days, weeks, rows, months and years with keyboard and returns focus on Escape', async () => {
  render(<Harness />);
  await open();
  await waitFor(() => expect(focused()).toBe('2026-10-05'));
  const steps = [
    ['{ArrowRight}', '2026-10-06'],
    ['{ArrowLeft}', '2026-10-05'],
    ['{ArrowDown}', '2026-10-12'],
    ['{ArrowUp}', '2026-10-05'],
    ['{Home}', '2026-10-04'],
    ['{End}', '2026-10-10'],
    ['{PageDown}', '2026-11-10'],
    ['{PageUp}', '2026-10-10'],
    ['{Shift>}{PageDown}{/Shift}', '2027-10-10'],
    ['{Shift>}{PageUp}{/Shift}', '2026-10-10'],
    ['x', '2026-10-10'],
  ];
  for (const [key, day] of steps) {
    await userEvent.keyboard(key!);
    await waitFor(() => expect(focused()).toBe(day));
  }
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('from')).toHaveFocus();
});
it('clamps focus and controls to inclusive bounds and pages with one tab stop', async () => {
  const view = render(<Harness initial="" min="2026-10-08" max="2026-11-15" />);
  const dialog = await open();
  await waitFor(() => expect(focused()).toBe('2026-10-08'));
  expect(within(dialog).getByRole('button', { name: 'Previous month' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Today' })).toBeDisabled();
  expect(dialog.querySelector('[data-date="2026-10-07"]')).toBeDisabled();
  await userEvent.keyboard('{ArrowLeft}');
  expect(focused()).toBe('2026-10-08');
  await userEvent.keyboard('{Shift>}{PageDown}{/Shift}');
  await waitFor(() => expect(focused()).toBe('2026-11-15'));
  expect(within(dialog).getByRole('button', { name: 'Next month' })).toBeDisabled();
  view.unmount();
  render(<Harness initial="2026-10-31" clearable={false} />);
  const next = await open();
  await userEvent.click(within(next).getByRole('button', { name: 'Next month' }));
  expect(next.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
  expect(next.querySelector('[data-date][tabindex="0"]')).toHaveAttribute(
    'data-date',
    '2026-11-30',
  );
  await userEvent.click(within(next).getByRole('button', { name: 'Previous month' }));
  expect(within(next).queryByRole('button', { name: 'Clear' })).toBeNull();
});
it('uses translated labels, locale week starts and Arabic arrow direction', async () => {
  await act(() => changeLanguage('de'));
  const view = render(<Harness />);
  let dialog = await open();
  expect(dialog).toHaveAccessibleName('Datumsauswahl');
  expect(within(dialog).getAllByRole('columnheader')[0]).toHaveAttribute('abbr', 'Montag');
  view.unmount();
  await act(() => changeLanguage('ar'));
  render(<Harness />);
  dialog = await open();
  expect(dialog).toHaveAttribute('dir', 'rtl');
  expect(within(dialog).getAllByRole('columnheader')[0]).toHaveAttribute('abbr', 'السبت');
  await waitFor(() => expect(focused()).toBe('2026-10-05'));
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(focused()).toBe('2026-10-04'));
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(focused()).toBe('2026-10-05'));
});
it('supports bare controls, custom placeholders, descriptions and disabled fields', async () => {
  const view = render(
    <DatePicker
      value=""
      onChange={vi.fn()}
      placeholder="Resume on"
      aria-invalid
      aria-describedby="hint"
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Resume on' });
  expect(trigger).not.toHaveAttribute('aria-labelledby');
  expect(trigger).toHaveAttribute('aria-describedby', 'hint');
  await userEvent.click(trigger);
  expect(await screen.findByRole('dialog')).not.toHaveAttribute('data-testid');
  view.unmount();
  render(<DatePicker value="" onChange={vi.fn()} disabled />);
  expect(screen.getByRole('button')).toBeDisabled();
});
