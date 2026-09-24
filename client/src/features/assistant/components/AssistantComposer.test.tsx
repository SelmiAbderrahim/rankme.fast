import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { AssistantComposer, ASSISTANT_MESSAGE_MAX_CHARS } from './AssistantComposer';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const props = () => ({
  draft: '',
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
});

describe('AssistantComposer', () => {
  it('updates the draft and submits trimmed text from the form', async () => {
    const values = props();
    const { rerender } = render(<AssistantComposer {...values} />);
    const textbox = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textbox, ' hello ');
    expect(values.onDraftChange).toHaveBeenCalled();

    rerender(<AssistantComposer {...values} draft=" hello " />);
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(values.onSend).toHaveBeenCalledWith('hello');
    expect(screen.getByText(`7 / ${ASSISTANT_MESSAGE_MAX_CHARS} characters`)).toBeInTheDocument();
  });

  it('sends on Enter but preserves Shift+Enter and IME composition', () => {
    const values = props();
    render(<AssistantComposer {...values} draft="Question" />);
    const textbox = screen.getByRole('textbox');

    expect(fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(values.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true });
    expect(values.onSend).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(textbox, { key: 'Enter' })).toBe(false);
    expect(values.onSend).toHaveBeenCalledWith('Question');
  });

  it('disables blank, disabled, and creating submissions while using shared loading UI', () => {
    const values = props();
    const { rerender } = render(<AssistantComposer {...values} />);
    const textbox = screen.getByRole('textbox');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.submit(textbox.closest('form')!);
    expect(values.onSend).not.toHaveBeenCalled();

    rerender(<AssistantComposer {...values} draft="Ready" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    rerender(<AssistantComposer {...values} draft="Ready" creating />);
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('replaces send with a working Stop button during streaming', async () => {
    const values = props();
    render(<AssistantComposer {...values} draft="Ready" streaming />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(values.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });
});
