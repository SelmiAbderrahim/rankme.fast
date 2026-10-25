import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { chooseOption } from '../../../test/radixSelect';
import { GscPropertyPicker } from './GscPropertyPicker';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const properties = [
  { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', matchesSite: true },
  { siteUrl: 'sc-domain:other.example', permissionLevel: 'siteOwner', matchesSite: false },
];

function show(props: Partial<Parameters<typeof GscPropertyPicker>[0]> = {}) {
  const onSelect = vi.fn();
  const onRefresh = vi.fn();
  render(<I18nextProvider i18n={i18n}>
    <GscPropertyPicker domain="example.com" propertyUrl={null} properties={properties}
      settingProperty={false} refreshing={false} onSelect={onSelect} onRefresh={onRefresh} {...props} />
  </I18nextProvider>);
  return { onSelect, onRefresh };
}

describe('Search Console property choice', () => {
  it('offers matching properties directly and requires confirmation for another site', async () => {
    const user = userEvent.setup();
    const { onSelect } = show();
    await chooseOption(user, screen.getByRole('combobox'), 'sc-domain:example.com');
    expect(onSelect).toHaveBeenCalledWith('sc-domain:example.com', false);
    await user.click(screen.getByRole('button', { name: 'Link a different property' }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Property from a different site' }), 'sc-domain:other.example');
    const dialog = screen.getByTestId('gsc-property-mismatch-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('other.example');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Link anyway' }));
    expect(onSelect).toHaveBeenLastCalledWith('sc-domain:other.example', true);
  });

  it('explains how to add a property and retries the list', async () => {
    const user = userEvent.setup();
    const { onRefresh } = show({ properties: [] });
    expect(screen.getByText(/No Search Console property found/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Search Console/ })).toHaveAttribute('href', 'https://search.google.com/search-console');
    await user.click(screen.getByTestId('gsc-property-refresh'));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('names a URL-prefix property by its host and keeps an unparseable value readable', async () => {
    const user = userEvent.setup();
    show({ properties: [
      { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner', matchesSite: true },
      { siteUrl: 'https://other.example/path', permissionLevel: 'siteOwner', matchesSite: false },
      { siteUrl: 'not a url', permissionLevel: 'siteOwner', matchesSite: false,
        inUseBy: [{ siteId: 's2', domain: 'used.example', displayName: '' }] },
    ] as never });
    await user.click(screen.getByRole('button', { name: 'Link a different property' }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Property from a different site' }), 'https://other.example/path');
    expect(within(screen.getByTestId('gsc-property-mismatch-dialog')).getByRole('heading')).toHaveTextContent('other.example');
    await user.click(within(screen.getByTestId('gsc-property-mismatch-dialog')).getByRole('button', { name: 'Cancel' }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Property from a different site' }), /not a url — used\.example/);
    expect(within(screen.getByTestId('gsc-property-mismatch-dialog')).getByRole('heading')).toHaveTextContent('not a url');
  });

  it('opens the other-property section when the linked property belongs to another site', () => {
    show({ propertyUrl: 'sc-domain:other.example' });
    expect(screen.getByTestId('gsc-property-other-select')).toHaveTextContent('sc-domain:other.example');
    expect(screen.getByTestId('gsc-property-other-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});
