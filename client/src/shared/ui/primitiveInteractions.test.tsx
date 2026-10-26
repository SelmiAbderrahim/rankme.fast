import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { Checkbox } from './checkbox';
import { Switch } from './switch';
import { Input } from './input';
import { Tabs, TabsList, TabsTrigger } from './tabs';
import { Breadcrumb, BreadcrumbLink } from './breadcrumb';
import { usePointerFocus } from './focus-modality';
import { releaseBodyPointerLock, preserveMovedFocus, useReleaseBodyPointerLockOnClose } from './overlay-release';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from './command';
import { initI18n, changeLanguage } from '@shared/i18n';
beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
it('expands small controls with a child hit area while preserving their native behavior', async () => {
  render(
    <>
      <RadioGroup>
        <RadioGroupItem value="one" aria-label="One" />
      </RadioGroup>
      <Checkbox aria-label="Check" />
      <Switch aria-label="Toggle" />
      <Input type="email" aria-label="Email" />
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">First</TabsTrigger>
        </TabsList>
      </Tabs>
      <Breadcrumb>
        <BreadcrumbLink href="#main">Home</BreadcrumbLink>
      </Breadcrumb>
    </>,
  );
  for (const role of ['radio', 'checkbox', 'switch']) {
    const control = screen.getByRole(role);
    const area = control.querySelector('[data-slot="hit-area"]')!;
    expect(area).toHaveClass('size-6', 'max-md:size-11');
    await userEvent.click(area);
    expect(control).toBeChecked();
  }
  expect(screen.getByRole('textbox')).toHaveAttribute('dir', 'ltr');
  expect(screen.getByRole('textbox')).toHaveClass('max-md:min-h-11');
  expect(screen.getByRole('tab')).toHaveClass('max-md:min-h-11');
  expect(screen.getByRole('tablist')).toHaveClass('flex-wrap');
  expect(screen.getByRole('link')).toHaveClass('max-md:min-w-11');
});
it('distinguishes real pointer activity from assistive clicks and resets on keyboard input', () => {
  const Probe = () => <span data-testid="modality">{String(usePointerFocus())}</span>;
  const view = render(<Probe />);
  fireEvent.pointerDown(document);
  expect(screen.getByTestId('modality')).toHaveTextContent('false');
  const pointer = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(pointer, 'pointerType', { value: 'mouse' });
  fireEvent(document, pointer);
  expect(screen.getByTestId('modality')).toHaveTextContent('true');
  fireEvent(document, pointer);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(screen.getByTestId('modality')).toHaveTextContent('false');
  view.unmount();
  render(<Probe />);
  expect(screen.getByTestId('modality')).toHaveTextContent('false');
});
it('unlocks closing overlays but leaves other active modals locked and preserves pointer focus moves', async () => {
  const Probe = ({ state }: { state: string }) => (
    <div ref={useReleaseBodyPointerLockOnClose()} role="dialog" data-state={state} />
  );
  const view = render(
    <>
      <Probe state="open" />
      <input aria-label="Outside" />
    </>,
  );
  document.body.style.pointerEvents = 'none';
  releaseBodyPointerLock();
  expect(document.body.style.pointerEvents).toBe('none');
  view.rerender(
    <>
      <Probe state="closed" />
      <input aria-label="Outside" />
    </>,
  );
  await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
  const keyboard = new Event('close', { cancelable: true });
  preserveMovedFocus()(keyboard);
  expect(keyboard.defaultPrevented).toBe(false);
  fireEvent.pointerDown(screen.getByRole('textbox'));
  screen.getByRole('textbox').focus();
  const pointer = new Event('close', { cancelable: true });
  preserveMovedFocus()(pointer);
  expect(pointer.defaultPrevented).toBe(true);
  const handled = new Event('close', { cancelable: true });
  const handler = vi.fn((event: Event) => event.preventDefault());
  preserveMovedFocus(handler)(handled);
  expect(handler).toHaveBeenCalledOnce();
  view.unmount();
  releaseBodyPointerLock();
});
it('keeps pointer toggles closed, respects prevented clicks and supports explicit modal menus', async () => {
  const view = render(
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Run</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole('button');
  fireEvent(
    trigger,
    new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true, cancelable: true }),
  );
  fireEvent.click(trigger);
  expect(await screen.findByRole('menu')).toBeInTheDocument();
  fireEvent(
    trigger,
    new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true, cancelable: true }),
  );
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
  view.rerender(
    <DropdownMenu>
      <DropdownMenuTrigger onClick={(e) => e.preventDefault()}>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>Menu</DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('menu')).toBeNull();
  view.rerender(
    <DropdownMenu modal>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Run</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('menu');
  expect(document.body.style.pointerEvents).toBe('none');
  await userEvent.keyboard('{Escape}');
  expect(document.body.style.pointerEvents).toBe('');
});
it('filters command choices and selects by keyboard', async () => {
  const select = vi.fn();
  render(
    <Command>
      <CommandInput aria-label="Search" />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem onSelect={select}>Sites</CommandItem>
          <CommandItem>Ranks</CommandItem>
          <CommandSeparator />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
  await userEvent.type(screen.getByRole('combobox'), 'Sites');
  await userEvent.keyboard('{Enter}');
  expect(select).toHaveBeenCalledWith('Sites');
  await userEvent.clear(screen.getByRole('combobox'));
  await userEvent.type(screen.getByRole('combobox'), 'missing');
  expect(screen.getByText('No matches')).toBeInTheDocument();
});
it('recovers an open cancelled between pointerdown and click and respects disabled triggers', async () => {
  const view = render(
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Run</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole('button');
  fireEvent(
    trigger,
    new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true, cancelable: true }),
  );
  await screen.findByRole('menu');
  await userEvent.keyboard('{Escape}');
  fireEvent.click(trigger);
  expect(await screen.findByRole('menu')).toBeInTheDocument();
  view.unmount();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger disabled>Unavailable</DropdownMenuTrigger>
      <DropdownMenuContent>Menu</DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('activates another control on the first pointer click outside an open menu', async () => {
  const action = vi.fn();
  render(
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Run</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button onClick={action}>Outside</button>
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
  await screen.findByRole('menu');
  await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
