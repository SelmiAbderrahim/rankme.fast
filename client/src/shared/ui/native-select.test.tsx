import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeSelect } from './native-select';

describe('NativeSelect', () => {
  it('is a real select that matches the Radix trigger height, border and chevron', () => {
    render(
      <NativeSelect aria-label="Device" defaultValue="mobile">
        <option value="desktop">Desktop</option>
        <option value="mobile">Mobile</option>
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'Device' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveClass('h-9', 'border-input', 'rounded-md', 'appearance-none');
    expect(select).toHaveValue('mobile');
    const icon = select.parentElement?.querySelector('[data-slot="native-select-icon"]');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards the ref (react-hook-form register) and change events', async () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <NativeSelect aria-label="Size" ref={ref}>
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    );
    expect(ref.current).toBe(screen.getByLabelText('Size'));
    await userEvent.selectOptions(screen.getByLabelText('Size'), 'b');
    expect(ref.current?.value).toBe('b');
  });

  it('sends widths to the wrapper and select styling to the select', () => {
    render(
      <NativeSelect aria-label="Wide" wrapperClassName="sm:w-64" className="min-h-11" disabled>
        <option>One</option>
      </NativeSelect>,
    );
    const select = screen.getByLabelText('Wide');
    expect(select.parentElement).toHaveClass('sm:w-64');
    expect(select).toHaveClass('min-h-11', 'disabled:cursor-not-allowed');
    expect(select).toBeDisabled();
  });
});
