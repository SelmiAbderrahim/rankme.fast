import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n, changeLanguage } from '@shared/i18n';
import { DisabledAction } from './DisabledAction';
import { FieldFeedback, fieldDescribedBy } from './FieldFeedback';
import { RecordCard, RecordCardList } from './RecordCard';
import { ScreenReaderTable } from './ScreenReaderTable';
import { FormActions } from './FormActions';
import { SkipLink } from './SkipLink';
import { SegmentedControl, SegmentedControlItem } from '@shared/ui/segmented-control';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@shared/ui/dropdown-menu';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
describe('shared client primitives', () => {
  it('exposes disabled reasons to keyboard users without activating the action', async () => {
    const click = vi.fn();
    const view = render(
      <DisabledAction disabled reason="Choose a site" onClick={click}>
        Run
      </DisabledAction>,
    );
    await userEvent.tab();
    expect(screen.getByRole('group', { name: 'Run' })).toHaveFocus();
    expect(screen.getByRole('group')).toHaveAccessibleDescription('Choose a site');
    await userEvent.click(screen.getByRole('button'));
    expect(click).not.toHaveBeenCalled();
    view.rerender(
      <DisabledAction
        id="run"
        aria-describedby="extra"
        loading
        loadingLabel="Running"
        reason="Wait"
      >
        Run
      </DisabledAction>,
    );
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('extra'),
    );
    view.rerender(<DisabledAction>Run</DisabledAction>);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('Wait')).toBeNull();
    view.rerender(<DisabledAction disabled>Run</DisabledAction>);
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-describedby');
  });
  it('links hints and errors in reading order and keeps the hint when an error appears', () => {
    expect(fieldDescribedBy('url', {})).toBeUndefined();
    expect(fieldDescribedBy('url', { hint: true })).toBe('url-hint');
    expect(fieldDescribedBy('url', { error: true })).toBe('url-error');
    expect(fieldDescribedBy('url', { hint: true, error: true })).toBe('url-hint url-error');
    const view = render(<FieldFeedback id="url" />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(
      <FieldFeedback
        id="url"
        hint="Use HTTPS"
        error="Invalid URL"
        hintTestId="hint"
        errorTestId="error"
        className="custom"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid URL');
    expect(screen.getByTestId('hint')).toHaveAttribute('id', 'url-hint');
    view.rerender(<FieldFeedback id="url" error="Invalid URL" />);
    expect(screen.queryByText('Use HTTPS')).toBeNull();
    view.rerender(<FieldFeedback id="url" hint="Use HTTPS" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders responsive records, isolated user text and semantic table fallback', () => {
    const view = render(
      <RecordCardList hideAt="4xl">
        <RecordCard
          title="example.com"
          description="Name"
          leading={<input type="checkbox" />}
          actions={<button>Edit</button>}
          badges={<span>Active</span>}
          fields={[
            null,
            false,
            { label: 'Visits', value: '12' },
            { label: 'Notes', value: 'Text', stacked: true },
          ]}
        >
          More
        </RecordCard>
      </RecordCardList>,
    );
    expect(screen.getByRole('list')).toHaveClass('@4xl:hidden');
    expect(screen.getByText('example.com').tagName).toBe('BDI');
    expect(screen.getByText('Visits').closest('dt')).toBeInTheDocument();
    view.rerender(
      <RecordCardList>
        <RecordCard title="Empty" />
      </RecordCardList>,
    );
    expect(screen.getByRole('list')).toHaveClass('md:hidden');
    expect(view.container.querySelector('dl')).toBeNull();
    view.rerender(
      <ScreenReaderTable aria-label="Chart values">
        <tbody>
          <tr>
            <td>12</td>
          </tr>
        </tbody>
      </ScreenReaderTable>,
    );
    expect(screen.getByRole('table')).not.toHaveClass('sr-only');
    expect(screen.getByRole('table').parentElement).toHaveClass('sr-only');
    view.rerender(
      <FormActions className="custom">
        <button>Save</button>
      </FormActions>,
    );
    expect(screen.getByRole('button').parentElement).toHaveClass('flex-wrap', 'custom');
    view.rerender(<SkipLink targetId="main" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '#main');
  });
  it('supports arrow keys and disables unavailable segmented choices', async () => {
    render(
      <SegmentedControl aria-label="Cadence" defaultValue="week">
        <SegmentedControlItem value="week">Weekly</SegmentedControlItem>
        <SegmentedControlItem value="day">Daily</SegmentedControlItem>
        <SegmentedControlItem value="off" disabled>
          Off
        </SegmentedControlItem>
      </SegmentedControl>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked());
    await userEvent.keyboard('{/ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Off' })).toBeDisabled();
  });
  it('opens a non-modal dropdown from click without pointerdown and restores keyboard focus', async () => {
    render(
      <>
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button>Outside</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe('none');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });
});
