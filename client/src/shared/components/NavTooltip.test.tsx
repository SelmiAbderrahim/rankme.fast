import { beforeEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n, changeLanguage } from '@shared/i18n';
import { TooltipProvider } from '@shared/ui/tooltip';
import { NavTooltip } from './NavTooltip';
beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
function Tip({ when, shortcut }: { when?: 'always' | 'truncated' | 'never'; shortcut?: string }) {
  return (
    <TooltipProvider delayDuration={0}>
      <NavTooltip label="Collapse" when={when} shortcut={shortcut}>
        <button>
          <span data-nav-label="">Collapse</span>
        </button>
      </NavTooltip>
    </TooltipProvider>
  );
}
it('shows one label and optional keyboard shortcut for pointer and keyboard users', async () => {
  const view = render(<Tip shortcut="[" />);
  await userEvent.hover(screen.getByRole('button'));
  expect((await screen.findByTestId('nav-tooltip')).querySelector('kbd')).toHaveTextContent('[');
  view.unmount();
  await changeLanguage('ar');
  render(<Tip />);
  fireEvent.focus(screen.getByRole('button'));
  expect(await screen.findByTestId('nav-tooltip')).toHaveTextContent('Collapse');
});
it('only shows a truncated label and keeps its trigger mounted when disabled', async () => {
  const view = render(<Tip when="never" />);
  const first = screen.getByRole('button');
  fireEvent.focus(first);
  expect(screen.queryByTestId('nav-tooltip')).toBeNull();
  view.rerender(<Tip when="truncated" />);
  expect(screen.getByRole('button')).toBe(first);
  fireEvent.blur(first);
  fireEvent.focus(first);
  expect(screen.queryByTestId('nav-tooltip')).toBeNull();
  const label = first.querySelector('[data-nav-label]')!;
  Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 200 });
  Object.defineProperty(label, 'clientWidth', { configurable: true, value: 100 });
  fireEvent.blur(first);
  fireEvent.focus(first);
  expect(await screen.findByTestId('nav-tooltip')).toHaveTextContent('Collapse');
  label.removeAttribute('data-nav-label');
  fireEvent.blur(first);
  fireEvent.focus(first);
  await act(async () => {});
  expect(screen.queryByTestId('nav-tooltip')).toBeNull();
});
