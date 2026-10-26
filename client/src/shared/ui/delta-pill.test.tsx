import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeltaPill } from './delta-pill';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { I18nextProvider } from 'react-i18next';

describe('DeltaPill', () => {
  it('includes the signed value in an explicit assistive label', async () => {
    initI18n({ initialLocale: 'en' });
    await changeLanguage('ar');
    const { unmount } = render(<I18nextProvider i18n={i18n}><DeltaPill value={-75} aria-label="Change" data-testid="named" /></I18nextProvider>);
    const formatted = new Intl.NumberFormat('ar', { signDisplay: 'exceptZero' }).format(-75);
    expect(screen.getByTestId('named')).toHaveAttribute('aria-label', `Change: \u2066${formatted}\u2069`);
    unmount();
    await changeLanguage('en');
  });
  it('keeps a named missing comparison distinct from zero', () => {
    render(<DeltaPill value={null} aria-label="Change" data-testid="named" />);
    expect(screen.getByTestId('named')).toHaveAttribute('aria-label', 'Change: —');
  });
  it('isolates the signed value from the badge and its surrounding prose', () => {
    render(<p dir="rtl"><DeltaPill value={-75} data-testid="delta" /></p>);
    expect(screen.getByTestId('delta').querySelector('bdi[dir="ltr"]')).toHaveTextContent('\u221275');
  });
  it('colors a positive change good when higher is better (default)', () => {
    render(<DeltaPill value={12} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('+12');
    expect(pill).toHaveAttribute('data-good', 'yes');
    expect(pill).toHaveClass('text-success');
  });

  it('colors a negative change bad when higher is better', () => {
    render(<DeltaPill value={-3} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('\u22123');
    expect(pill).toHaveAttribute('data-good', 'no');
    expect(pill).toHaveClass('text-destructive');
  });

  it('inverts goodness when lower is better (rank position)', () => {
    render(<DeltaPill value={-2} goodDirection="down" data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveAttribute('data-good', 'yes');
    expect(pill).toHaveClass('text-success');
  });

  it('renders zero as neutral', () => {
    render(<DeltaPill value={0} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveAttribute('data-good', 'neutral');
    expect(pill).toHaveClass('text-muted-foreground');
  });

  it('renders null as an em-dash, neutral', () => {
    render(<DeltaPill value={null} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('—');
    expect(pill).toHaveAttribute('data-good', 'neutral');
  });

  it('preserves compact precision through shared Intl options', () => {
    render(
      <DeltaPill value={1500} options={{ notation: 'compact' }} data-testid="d" />,
    );
    expect(screen.getByTestId('d')).toHaveTextContent('+1.5K');
  });
});
