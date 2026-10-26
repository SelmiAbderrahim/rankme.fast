import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DatePicker } from '@shared/components/DatePicker';
import { Bdi } from '@shared/components/Bdi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { initPublicI18n } from './publicI18n';
import { pickDate, clearDate } from './datePicker';
import { chooseOption, listOptions } from './radixSelect';
import { resolveLazyRoutes } from './resolveLazyRoutes';
import { textContentMatcher, visibleText } from './textContent';
import { stubViewerTimeZone } from './timeZone';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('matches nested isolated text at the deepest whole-text element', () => {
  render(<section><p>Showing <Bdi>مثال.test</Bdi> results</p><span>{'\u2068example.test\u2069'}</span></section>);
  expect(screen.getByText(textContentMatcher('Showing مثال.test results')).tagName).toBe('P');
  expect(screen.getByText(textContentMatcher('example.test')).tagName).toBe('SPAN');
  expect(visibleText(screen.getByText(textContentMatcher('example.test')))).toBe('example.test');
  expect(visibleText(null)).toBe('');
  expect(textContentMatcher('missing')('', null)).toBe(false);
});

it('keeps global regex matching stable across parent and child checks', () => {
  render(<div><p>Example <b>result</b></p></div>);
  const expression = /Example result/g;
  expression.lastIndex = 4;
  const matcher = textContentMatcher(expression);
  expect(screen.getByText(matcher).tagName).toBe('P');
  expect(screen.getByText(matcher).tagName).toBe('P');
  expect(expression.lastIndex).toBe(4);
});

it('resolves nested lazy routes without mutating their original definitions', async () => {
  const Component = () => null;
  const loader = vi.fn();
  const routes = [{ path: 'parent', handle: { title: 'Parent' }, children: [{ index: true as const, lazy: async () => ({ Component, loader }) }, { path: 'plain' }] }];
  const resolved = await resolveLazyRoutes(routes);
  expect(resolved[0]).toMatchObject({ path: 'parent', handle: { title: 'Parent' }, children: [{ index: true, Component, loader }, { path: 'plain' }] });
  expect(resolved[0]!.children![0]).not.toHaveProperty('lazy');
  expect(routes[0]!.children[0]).toHaveProperty('lazy');
  expect(await resolveLazyRoutes([])).toEqual([]);
});

it('loads real public documentation translations through the existing backend', async () => {
  const instance = await initPublicI18n({ initialLocale: 'ar' });
  expect(instance.language).toBe('ar');
  expect(instance.t('navigationLabel', { ns: 'docs' })).toBe('التنقل في الوثائق');
  expect(await initPublicI18n({ initialLocale: 'en' })).toBe(instance);
  expect(instance.t('navigationLabel', { ns: 'docs' })).toBe('Documentation navigation');
});

it('changes viewer formatting without overriding explicit UTC calendar dates', () => {
  stubViewerTimeZone('America/Los_Angeles');
  const time = new Date('2026-03-10T00:00:00Z');
  expect(new Intl.DateTimeFormat('en-US', { dateStyle: 'short' }).format(time)).toBe('3/9/26');
  expect(new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeZone: 'UTC' }).format(time)).toBe('3/10/26');
  expect(Intl.DateTimeFormat.supportedLocalesOf(['en-US'])).toEqual(['en-US']);
});

function Calendar({ clearable = true, min }: { clearable?: boolean; min?: string }) {
  const [day, setDay] = useState('2026-10-10');
  return <DatePicker value={day} onChange={setDay} min={min} clearable={clearable} data-testid="calendar" />;
}
it('chooses earlier and later months through the real shared calendar, then clears', async () => {
  await initPublicI18n({ initialLocale: 'en' });
  const user = userEvent.setup();
  render(<Calendar />);
  const trigger = screen.getByTestId('calendar');
  await pickDate(user, trigger, '2026-11-05');
  expect(trigger).toHaveTextContent('Nov');
  await pickDate(user, trigger, '2026-09-03');
  expect(trigger).toHaveTextContent('Sep');
  await clearDate(user, trigger);
  expect(trigger).toHaveTextContent('Pick a date');
  await expect(pickDate(user, trigger, '2026-02-30')).rejects.toThrow('invalid calendar day');
});
it('fails clearly when a calendar bound or clear action prevents the requested interaction', async () => {
  await initPublicI18n({ initialLocale: 'en' });
  const user = userEvent.setup();
  const view = render(<Calendar min="2026-10-05" />);
  await expect(pickDate(user, screen.getByTestId('calendar'), '2026-09-10')).rejects.toThrow('cannot navigate');
  view.unmount();
  render(<Calendar clearable={false} />);
  await expect(clearDate(user, screen.getByTestId('calendar'))).rejects.toThrow('not clearable');
});

it('lists and chooses real portalled select options by accessible name', async () => {
  const user = userEvent.setup();
  render(<Select defaultValue="one"><SelectTrigger aria-label="Choice"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">First</SelectItem><SelectItem value="two">Second</SelectItem></SelectContent></Select>);
  const trigger = screen.getByRole('combobox', { name: 'Choice' });
  expect(await listOptions(user, trigger)).toEqual(['First', 'Second']);
  expect(screen.queryByRole('listbox')).toBeNull();
  await chooseOption(user, trigger, 'Second');
  expect(trigger).toHaveTextContent('Second');
});
