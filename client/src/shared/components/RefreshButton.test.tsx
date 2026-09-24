import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { RefreshButton } from './RefreshButton';

const renderButton = (props: Partial<React.ComponentProps<typeof RefreshButton>> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <RefreshButton
        onRefresh={props.onRefresh ?? vi.fn()}
        isRefreshing={props.isRefreshing ?? false}
        cooldownUntil={props.cooldownUntil ?? null}
        labelKey="backlinks:refresh.button"
        cooldownKey="backlinks:refresh.cooldown"
        data-testid="refresh-btn"
        {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RefreshButton', () => {
  it('renders the localized label and aria-label, enabled by default', () => {
    renderButton();
    const button = screen.getByTestId('refresh-btn');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName('Refresh');
    expect(button).toHaveTextContent('Refresh');
  });

  it('click calls onRefresh', async () => {
    const onRefresh = vi.fn();
    renderButton({ onRefresh });
    await userEvent.click(screen.getByTestId('refresh-btn'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables and spins the icon while refreshing', () => {
    renderButton({ isRefreshing: true });
    const button = screen.getByTestId('refresh-btn');
    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
  });

  it('honours the explicit disabled prop', () => {
    renderButton({ disabled: true });
    expect(screen.getByTestId('refresh-btn')).toBeDisabled();
  });

  it('a past cooldownUntil leaves the button enabled', () => {
    renderButton({ cooldownUntil: Date.now() - 5_000 });
    expect(screen.getByTestId('refresh-btn')).toBeEnabled();
  });

  it('a future cooldownUntil disables the button, counts down each second, re-enables at zero', () => {
    vi.useFakeTimers();
    renderButton({ cooldownUntil: Date.now() + 3_000 });
    const button = screen.getByTestId('refresh-btn');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Wait 3s before refreshing.');
    expect(button).toHaveAccessibleName('Wait 3s before refreshing.');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(button).toHaveTextContent('Wait 2s before refreshing.');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Refresh');
  });

  it('renders the Arabic label under the ar locale without flipping the icon', async () => {
    await changeLanguage('ar');
    renderButton();
    const button = screen.getByTestId('refresh-btn');
    expect(button).toHaveTextContent('تحديث');
    // The spin/rotation classes are the only transforms; no rtl:flip class.
    expect(button.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('rtl');
  });
});
