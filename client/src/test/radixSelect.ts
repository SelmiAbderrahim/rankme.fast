import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Select options live in a portal and can finish loading after opening. */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, option: string | RegExp): Promise<void> {
  await user.click(trigger);
  const listbox = await screen.findByRole('listbox');
  await user.click(await within(listbox).findByRole('option', { name: option }));
}

export async function listOptions(user: UserEvent, trigger: HTMLElement): Promise<string[]> {
  await user.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const names = within(listbox).getAllByRole('option').map((option) => option.textContent ?? '');
  await user.keyboard('{Escape}');
  return names;
}
