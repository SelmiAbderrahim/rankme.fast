import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AccountPage } from './AccountPage';

vi.mock('./ProfileInfoCard', () => ({ ProfileInfoCard: () => <div>PROFILE_BODY</div> }));
vi.mock('./ExportData', () => ({ ExportData: () => <div>EXPORT_BODY</div> }));
vi.mock('./DeleteAccountLink', () => ({ DeleteAccountLink: () => <div>DELETE_LINK</div> }));
vi.mock('@features/settings', () => ({
  ApiKeysPanel: () => <div>API_KEYS_BODY</div>,
  McpPermissionsPanel: () => <div>MCP_BODY</div>,
}));

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
};

const renderAt = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <I18nextProvider i18n={i18n}>
      <Routes>
        <Route path="/settings/profile" element={<AccountPage />} />
        <Route path="/settings/security" element={<div>SECURITY_DESTINATION</div>} />
        <Route path="/settings/notifications" element={<div>NOTIFICATIONS_DESTINATION</div>} />
        <Route path="/settings/workspace" element={<div>WORKSPACE_DESTINATION</div>} />
      </Routes>
      <LocationProbe />
    </I18nextProvider>
  </MemoryRouter>,
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('AccountPage', () => {
  it('defaults to the profile tab and uses the shared page gutter', () => {
    renderAt('/settings/profile');
    expect(screen.getByText('PROFILE_BODY')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    const page = screen.getByTestId('account-page');
    expect(page).toHaveClass('px-4', 'py-8');
    expect(page).not.toHaveClass('mx-auto');
  });

  it('retains direct MCP, API key, and privacy tab links', () => {
    renderAt('/settings/profile?tab=mcp');
    expect(screen.getByText('MCP_BODY')).toBeInTheDocument();
  });

  it('falls back to profile for an unknown tab', () => {
    renderAt('/settings/profile?tab=bogus');
    expect(screen.getByText('PROFILE_BODY')).toBeInTheDocument();
  });

  it('writes a tab selection to the URL', async () => {
    renderAt('/settings/profile');
    await userEvent.click(screen.getByRole('tab', { name: 'MCP permissions' }));
    expect(await screen.findByText('MCP_BODY')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tab=mcp'));
  });

  it.each([
    ['security', 'SECURITY_DESTINATION', '/settings/security'],
    ['notifications', 'NOTIFICATIONS_DESTINATION', '/settings/notifications'],
    ['branding', 'WORKSPACE_DESTINATION', '/settings/workspace'],
  ])('redirects the old %s tab to its one settings page', (tab, body, path) => {
    renderAt(`/settings/profile?tab=${tab}`);
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(path);
  });

  it('shows the privacy tab with a link to the one deletion flow', () => {
    renderAt('/settings/profile?tab=privacy');
    expect(screen.getByText('EXPORT_BODY')).toBeInTheDocument();
    expect(screen.getByText('DELETE_LINK')).toBeInTheDocument();
  });
});
