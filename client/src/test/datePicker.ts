import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { parseDateOnly } from '@shared/lib/dateOnly';

/** Navigate the shared calendar and select a calendar day without UTC conversion. */
export async function pickDate(user: UserEvent, trigger: HTMLElement, value: string): Promise<void> {
  if (parseDateOnly(value) === null) throw new Error(`pickDate: invalid calendar day ${value}`);
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog');
  const target = value.slice(0, 7);
  for (let step = 0; step < 600; step += 1) {
    const month = within(dialog).getByRole('grid').getAttribute('data-month') ?? '';
    if (month === target) break;
    const direction = month < target ? 'next' : 'previous';
    const navigation = dialog.querySelector<HTMLButtonElement>(`[data-nav="${direction}"]`);
    if (!navigation || navigation.disabled) throw new Error(`pickDate: cannot navigate to ${value}`);
    await user.click(navigation);
  }
  const grid = within(dialog).getByRole('grid');
  const day = grid.querySelector<HTMLButtonElement>(`[data-date="${value}"]`);
  if (!day || day.disabled || grid.getAttribute('data-month') !== target) throw new Error(`pickDate: ${value} is outside the available calendar`);
  await user.click(day);
}

export async function clearDate(user: UserEvent, trigger: HTMLElement): Promise<void> {
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog');
  const clear = dialog.querySelector<HTMLButtonElement>('[data-action="clear"]');
  if (!clear) throw new Error('clearDate: calendar is not clearable');
  await user.click(clear);
}
