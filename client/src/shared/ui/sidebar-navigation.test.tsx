import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarMenuButton, SidebarProvider } from './sidebar';

describe('sidebar navigation labels', () => {
  it('allows a long translated label to wrap to two lines', () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton><span>Исследование ключевых слов</span></SidebarMenuButton>
      </SidebarProvider>,
    );
    const row = screen.getByRole('button', { name: 'Исследование ключевых слов' });
    expect(row).toHaveClass('min-h-8', 'h-auto');
    expect(row.className).toContain('[&>span:last-child]:line-clamp-2');
  });
});
