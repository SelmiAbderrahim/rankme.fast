import { createRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover, PopoverTrigger, PopoverContent } from '@shared/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@shared/ui/dropdown-menu';

describe('site navigation composed trigger references', () => {
  it('forwards the site switcher trigger to its native focus target', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Popover>
        <PopoverTrigger asChild ref={ref}>
          <button>Switch site</button>
        </PopoverTrigger>
      </Popover>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Switch site' }));
  });
  it('forwards a rail flyout trigger to its native focus target', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={ref}>
          <button>Visibility</button>
        </DropdownMenuTrigger>
      </DropdownMenu>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Visibility' }));
  });
});

it('keeps composed menu options operable after the trigger forwards its ref', async () => {
  const Options = () => {
    const [checked, setChecked] = useState(false);
    const [mode, setMode] = useState('all');
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <span>Portalled options</span>
        </DropdownMenuPortal>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Site options</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
              onSelect={(event) => event.preventDefault()}
            >
              Show details
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
              <DropdownMenuRadioItem value="all" onSelect={(event) => event.preventDefault()}>
                All sites
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="recent" onSelect={(event) => event.preventDefault()}>
                Recent sites
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>
              More <DropdownMenuShortcut>→</DropdownMenuShortcut>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Nested page</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  render(<Options />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Options' }));
  expect(screen.getByText('Portalled options')).toBeInTheDocument();
  expect(screen.getByText('Site options')).toBeInTheDocument();
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Show details' }));
  expect(screen.getByRole('menuitemcheckbox', { name: 'Show details' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('menuitemradio', { name: 'Recent sites' }));
  expect(screen.getByRole('menuitemradio', { name: 'Recent sites' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(screen.getByRole('menuitemradio', { name: 'All sites' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  act(() => screen.getByRole('menuitem', { name: 'More →' }).focus());
  await user.keyboard('{ArrowRight}');
  expect(await screen.findByRole('menuitem', { name: 'Nested page' })).toBeVisible();
  await user.keyboard('{Escape}');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Options' })).toHaveFocus());
});

it('returns focus to a composed popover trigger after closing its content', async () => {
  const user = userEvent.setup();
  render(
    <Popover>
      <PopoverTrigger>Switch site</PopoverTrigger>
      <PopoverContent>
        <input aria-label="Filter sites" />
      </PopoverContent>
    </Popover>,
  );
  await user.click(screen.getByRole('button', { name: 'Switch site' }));
  expect(screen.getByRole('textbox', { name: 'Filter sites' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Switch site' })).toHaveFocus();
});

it('preserves outside focus when the pointer leaves a menu during its closing animation', () => {
  const Menu = ({ state }: { state: 'open' | 'closed' }) => {
    const [message, setMessage] = useState('waiting');
    return (
      <>
        <output>{message}</output>
        <button>Outside focus target</button>
        <DropdownMenu open>
          <DropdownMenuTrigger>Options</DropdownMenuTrigger>
          <DropdownMenuContent data-state={state}>
            <DropdownMenuItem onPointerLeave={() => setMessage('left')}>
              With handler
            </DropdownMenuItem>
            <DropdownMenuItem>Without handler</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  };
  const view = render(<Menu state="open" />);
  const withHandler = screen.getByRole('menuitem', { name: 'With handler' });
  const withoutHandler = screen.getByRole('menuitem', { name: 'Without handler' });
  const leave = (element: HTMLElement) => {
    const event = new MouseEvent('pointerout', {
      bubbles: true,
      cancelable: true,
      relatedTarget: document.body,
    });
    fireEvent(element, event);
    return event;
  };
  expect(leave(withHandler).defaultPrevented).toBe(false);
  expect(screen.getByRole('status')).toHaveTextContent('left');
  // Radix retains the same content with data-state=closed during CSS exit animation.
  view.rerender(<Menu state="closed" />);
  act(() => screen.getByRole('button', { name: 'Outside focus target' }).focus());
  expect(leave(withHandler).defaultPrevented).toBe(true);
  expect(leave(withoutHandler).defaultPrevented).toBe(true);
  expect(screen.getByRole('button', { name: 'Outside focus target' })).toHaveFocus();
});
