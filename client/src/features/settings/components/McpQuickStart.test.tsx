import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { absoluteUrl } from '@shared/seo';
import {
  buildClaudeCodeConfig,
  buildCursorConfig,
  McpQuickStart,
} from './McpQuickStart';

const writeText = vi.fn<(value: string) => Promise<void>>();

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

describe('MCP quick start', () => {
  it('builds client configurations around the supplied endpoint', () => {
    const endpoint = 'https://app.example/api/mcp';
    expect(buildClaudeCodeConfig(endpoint)).toContain(
      `"url":"${endpoint}"`,
    );
    expect(buildClaudeCodeConfig(endpoint)).toContain('${RANKMEFAST_API_KEY}');
    expect(JSON.parse(buildCursorConfig(endpoint))).toEqual({
      mcpServers: {
        rankmefast: {
          url: endpoint,
          headers: { Authorization: 'Bearer rmf_REPLACE_WITH_YOUR_KEY' },
        },
      },
    });
  });

  it('renders the env-derived endpoint, client snippets, API-key link, and docs link', () => {
    render(
      <MemoryRouter>
        <McpQuickStart />
      </MemoryRouter>,
    );
    expect(screen.getByText(absoluteUrl('/api/mcp'))).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage API keys' })).toHaveAttribute(
      'href',
      '/profile?tab=api-keys',
    );
    expect(screen.getByTestId('docs-link-rankmefast-mcp')).toHaveAttribute(
      'href',
      '/docs/rankmefast-mcp',
    );
  });

  it('copies the endpoint and each client configuration with visible feedback', async () => {
    render(
      <MemoryRouter>
        <McpQuickStart />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy MCP endpoint' }));
    expect(writeText).toHaveBeenLastCalledWith(absoluteUrl('/api/mcp'));

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy Claude Code configuration' }),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      buildClaudeCodeConfig(absoluteUrl('/api/mcp')),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy Cursor configuration' }),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      buildCursorConfig(absoluteUrl('/api/mcp')),
    );
    expect(screen.getAllByText('Copied')).toHaveLength(1);
  });

  it('surfaces a clipboard failure and clears it after a successful retry', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    render(
      <MemoryRouter>
        <McpQuickStart />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy MCP endpoint' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your browser couldn't copy that value.",
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy Cursor configuration' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
