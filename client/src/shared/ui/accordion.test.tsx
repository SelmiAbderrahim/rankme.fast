import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './accordion';

describe('Accordion', () => {
  const renderOne = () =>
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>Question?</AccordionTrigger>
          <AccordionContent>Answer.</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );

  it('shows the trigger and hides content until opened', async () => {
    renderOne();
    const trigger = screen.getByRole('button', { name: 'Question?' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Answer.')).toBeInTheDocument();
  });
});
