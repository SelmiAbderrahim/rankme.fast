import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo, BRAND_NAME } from './index';

describe('BrandLogo', () => {
  it('renders the wordmark variant by default', () => {
    const { container } = render(<BrandLogo className="x" />);
    expect(container.querySelector('.brand-logo')).toBeInTheDocument();
    expect(container.querySelector('.x')).toBeInTheDocument();
  });

  it('renders the mark-only variant with an accessible label', () => {
    render(<BrandLogo markOnly style={{ color: 'red' }} />);
    expect(screen.getByRole('img', { name: BRAND_NAME })).toBeInTheDocument();
  });
});
