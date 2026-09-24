import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Site } from '@features/sites';
import { changeLanguage, initI18n } from '@shared/i18n';
import { createPermissiveMcpSettings } from '../mcpScopes';
import type { McpPermissionSettings } from '../types';
import { McpScopeFields } from './McpScopeFields';

const sites: Site[] = [
  {
    id: 'site-1',
    url: 'https://one.example',
    domain: 'one.example',
    displayName: 'Site One',
    paused: false,
    pausedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'site-2',
    url: 'https://two.example',
    domain: 'two.example',
    displayName: '',
    paused: false,
    pausedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

function Harness({
  initial = createPermissiveMcpSettings(),
  control = 'switch',
  availableSites = sites,
  disabled = false,
}: {
  initial?: McpPermissionSettings;
  control?: 'switch' | 'checkbox';
  availableSites?: Site[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <McpScopeFields
      idPrefix="test"
      value={value}
      sites={availableSites}
      control={control}
      disabled={disabled}
      onChange={setValue}
    />
  );
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
describe('McpScopeFields', () => {
  it('renders every account tool switch and updates tool and spend permissions', async () => {
    render(<Harness />);
    expect(screen.getAllByRole('switch')).toHaveLength(11);
    const listSites = screen.getByRole('switch', { name: 'List sites' });
    const spend = screen.getByRole('switch', {
      name: 'Allow tools that use plan allowance',
    });
    expect(listSites).toBeChecked();
    await userEvent.click(listSites);
    await userEvent.click(spend);
    expect(listSites).not.toBeChecked();
    expect(spend).not.toBeChecked();
  });

  it('switches from all sites to a non-empty selection and edits that selection', async () => {
    render(<Harness control="checkbox" />);
    const allSites = screen.getByRole('checkbox', { name: 'Allow all sites' });
    expect(allSites).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Site One' })).toBeDisabled();

    await userEvent.click(allSites);
    const first = screen.getByRole('checkbox', { name: 'Site One' });
    const second = screen.getByRole('checkbox', { name: 'two.example' });
    expect(first).toBeChecked();
    expect(first).toBeDisabled();
    expect(second).not.toBeChecked();

    await userEvent.click(second);
    expect(first).not.toBeDisabled();
    await userEvent.click(first);
    expect(first).not.toBeChecked();
    expect(second).toBeChecked();
    await userEvent.click(allSites);
    expect(allSites).toBeChecked();
  });

  it('shows stale selected sites as unavailable and honors the disabled state', () => {
    const initial = createPermissiveMcpSettings();
    initial.allowedSiteIds = ['missing-site'];
    render(<Harness initial={initial} availableSites={[]} disabled />);
    expect(screen.getByText('Unavailable site')).toBeInTheDocument();
    expect(screen.getByText(/missing-site/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'List sites' })).toBeDisabled();
  });

  it('explains why site restrictions need at least one site', () => {
    render(<Harness availableSites={[]} />);
    expect(
      screen.getByText('Add a site before creating a site restriction.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Allow all sites' })).toBeDisabled();
  });
});
