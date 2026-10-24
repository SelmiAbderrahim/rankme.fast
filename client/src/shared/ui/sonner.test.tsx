import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n, changeLanguage } from '@shared/i18n';
const captured = vi.hoisted(() => ({ props: {} as Record<string, unknown>, error: vi.fn() }));
vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="toaster" />;
  },
  toast: { error: captured.error },
}));
vi.mock('@shared/theme/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dark' }) }));
import { toast } from 'sonner';
import { Toaster, closeButtonPlacement, measureHeaderClearance, TOAST_DURATION_MS, TOAST_VISIBLE_LIMIT } from './sonner';
beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
it('ships localized close controls, bounded stacking and automatic non-error duration', async () => {
  render(<Toaster dir="rtl" toastOptions={{ style: { color: 'red' } }} />);
  expect(screen.getByTestId('toaster')).toBeInTheDocument();
  expect(captured.props).toMatchObject({
    theme: 'dark',
    duration: TOAST_DURATION_MS,
    visibleToasts: TOAST_VISIBLE_LIMIT,
    closeButton: true,
    containerAriaLabel: 'Notifications',
  });
  expect(captured.props.toastOptions).toMatchObject({
    closeButtonAriaLabel: 'Close notification',
    style: {
      color: 'red',
      paddingInlineEnd: '2.25rem',
      '--toast-close-button-start': '0.5rem',
      '--toast-close-button-end': 'auto',
    },
  });
  expect(closeButtonPlacement('ltr')).toMatchObject({
    '--toast-close-button-start': 'auto',
    '--toast-close-button-end': '0.5rem',
  });
  expect(closeButtonPlacement(undefined)).toEqual(closeButtonPlacement('ltr'));
  toast.error('Failed');
  expect(captured.error).toHaveBeenLastCalledWith('Failed', { duration: Infinity });
  toast.error('Brief', { duration: 100 });
  expect(captured.error).toHaveBeenLastCalledWith('Brief', { duration: 100 });
});
it('clears measured headers and ignores offscreen or unmeasurable headers', () => {
  expect(measureHeaderClearance()).toBeNull();
  const header = document.createElement('header');
  document.body.append(header);
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 79.5,
    height: 79.5,
  } as DOMRect);
  expect(measureHeaderClearance()).toBe(88);
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    top: 170,
    bottom: 200,
    height: 30,
  } as DOMRect);
  expect(measureHeaderClearance()).toBeNull();
  header.remove();
});
