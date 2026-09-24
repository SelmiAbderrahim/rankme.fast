import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { AssistantUnavailableCard } from './AssistantUnavailableCard';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AssistantUnavailableCard', () => {
  it('explains the outage and retries on demand', async () => {
    const onRetry = vi.fn();
    render(<AssistantUnavailableCard onRetry={onRetry} />);
    expect(screen.getByTestId('assistant-state-unavailable')).toHaveTextContent(
      'Assistant temporarily unavailable',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
