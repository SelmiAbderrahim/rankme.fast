import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AccountPage } from './AccountPage';

// Stub every tab body so this suite isolates the tab/URL logic.
vi.mock('./ProfileInfoCard', () => ({ ProfileInfoCard: () => <div>PROFILE_BODY</div> }));
vi.mock('./ExportData', () => ({ ExportData: () => <div>EXPORT_BODY</div> }));
vi.mock('./DeleteAccount', () => ({ DeleteAccount: () => <div>DELETE_BODY</div> }));
vi.mock('@features/auth', () => ({ SecuritySettings: () => <div>SECURITY_BODY</div> }));
vi.mock('@features/settings', () => ({
  NotificationPreferences: () => <div>NOTIF_BODY</div>,
  ApiKeysPanel: () => <div>API_KEYS_BODY</div>,
  BrandingPanel: () => <div>BRANDING_BODY</div>,
  McpPermissionsPanel: () => <div>MCP_BODY</div>,
}));

const LocationProbe = () => {
  const { search } = useLocation();
  return <span data-testid="search">{search}</span>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nextProvider i18n={i18n}>
        <AccountPage />
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
  it('defaults to the profile tab', () => {
    renderAt('/profile');
    expect(screen.getByText('PROFILE_BODY')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('deep-links to a tab from ?tab=', () => {
    renderAt('/profile?tab=security');
    expect(screen.getByText('SECURITY_BODY')).toBeInTheDocument();
  });

  it('falls back to profile for an unknown tab value', () => {
    renderAt('/profile?tab=bogus');
    expect(screen.getByText('PROFILE_BODY')).toBeInTheDocument();
  });

  it('switches tab and writes ?tab= to the URL', async () => {
    renderAt('/profile');
    await userEvent.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(await screen.findByText('NOTIF_BODY')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent('tab=notifications'),
    );
  });

  it('deep-links to the branding tab', () => {
    renderAt('/profile?tab=branding');
    expect(screen.getByText('BRANDING_BODY')).toBeInTheDocument();
  });

  it('deep-links to the MCP permissions tab', () => {
    renderAt('/profile?tab=mcp');
    expect(screen.getByText('MCP_BODY')).toBeInTheDocument();
  });

  it('renders the privacy tab', () => {
    renderAt('/profile?tab=privacy');
    expect(screen.getByText('EXPORT_BODY')).toBeInTheDocument();
    expect(screen.getByText('DELETE_BODY')).toBeInTheDocument();
  });
});
