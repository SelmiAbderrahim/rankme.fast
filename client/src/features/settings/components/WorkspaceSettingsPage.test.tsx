import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { WorkspaceSettingsPage } from './WorkspaceSettingsPage';

vi.mock('./BrandingPanel', () => ({ BrandingPanel: () => <div>BRANDING_PANEL</div> }));

it('has one workspace heading above the branding controls', () => {
  initI18n({ initialLocale: 'en' });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><WorkspaceSettingsPage /></MemoryRouter></I18nextProvider>);
  expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeInTheDocument();
  expect(screen.getByText('BRANDING_PANEL')).toBeInTheDocument();
  expect(screen.getByText(/branding on client reports/i)).toBeInTheDocument();
});
