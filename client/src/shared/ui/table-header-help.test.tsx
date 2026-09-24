import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@/shared/i18n';
import { Button } from './button';
import { TableHeaderHelp } from './table-header-help';
import { TooltipProvider } from './tooltip';

function renderHelp(node: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

describe('TableHeaderHelp', () => {
  beforeEach(() => {
    initI18n({ initialLocale: 'en' });
  });

  it('opens from hover', async () => {
    const user = userEvent.setup();
    renderHelp(<TableHeaderHelp label="Results" description="Returned rows." />);

    const trigger = screen.getByRole('button', { name: 'About Results' });
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Returned rows.');
  });

  it('opens from focus and closes with Escape', async () => {
    const user = userEvent.setup();
    renderHelp(<TableHeaderHelp label="Source" description="Live or cached." />);

    await user.tab();
    const trigger = screen.getByRole('button', { name: 'About Source' });
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('toggles from click without activating an adjacent sort control', async () => {
    const user = userEvent.setup();
    const sort = vi.fn();

    renderHelp(
      <TableHeaderHelp
        label={<Button onClick={sort}>Position</Button>}
        labelText="Position"
        description="Current search rank."
      />,
    );

    const trigger = screen.getByRole('button', { name: 'About Position' });
    await user.click(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Current search rank.');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(sort).not.toHaveBeenCalled();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the first click open after hover and closes on the second click', async () => {
    const user = userEvent.setup();
    renderHelp(<TableHeaderHelp label="Traffic" description="Estimated visits." />);

    const trigger = screen.getByRole('button', { name: 'About Traffic' });
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Estimated visits.');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Estimated visits.');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('stops pointer events from bubbling to a sortable header', () => {
    const parentPointerDown = vi.fn();
    renderHelp(
      <div onPointerDown={parentPointerDown}>
        <TableHeaderHelp label="Delta" description="Position change." />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'About Delta' }));
    expect(parentPointerDown).not.toHaveBeenCalled();
  });

  it('toggles for keyboard-style clicks without a preceding pointer event', async () => {
    renderHelp(<TableHeaderHelp label="Source" description="Live or cached." />);

    const trigger = screen.getByRole('button', { name: 'About Source' });
    fireEvent.click(trigger, { detail: 0 });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Live or cached.');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger, { detail: 0 });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses labelText for a non-string label', () => {
    renderHelp(
      <TableHeaderHelp
        label={<span>CTR</span>}
        labelText="Click-through rate"
        description="Clicks divided by impressions."
      />,
    );

    expect(screen.getByRole('button', { name: 'About Click-through rate' })).toBeInTheDocument();
  });
});
