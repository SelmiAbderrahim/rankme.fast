import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { DocsLink } from './DocsLink';

beforeAll(async () => {
  await initI18n();
});

const renderWith = async (locale: string, node: React.ReactNode) => {
  await changeLanguage(locale as 'en');
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
};

describe('DocsLink', () => {
  it('renders localized href for each supported locale', async () => {
    for (const locale of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const) {
      const { unmount } = await renderWith(locale, <DocsLink slug="audit-report" />);
      const anchor = screen.getByTestId('docs-link-audit-report');
      const prefix = locale === 'en' ? '' : `/${locale}`;
      expect(anchor).toHaveAttribute('href', `${prefix}/docs/audit-report`);
      expect(anchor).not.toHaveAttribute('target');
      unmount();
    }
  });

  it('renders the default "Learn more" label from the common namespace', async () => {
    await renderWith('en', <DocsLink slug="ai-summary" />);
    expect(screen.getByTestId('docs-link-ai-summary').textContent).toMatch(
      /learn/i,
    );
  });

  it('honours a labelKey override', async () => {
    await renderWith('en', <DocsLink slug="ai-summary" labelKey="docsLink.help" />);
    expect(screen.getByTestId('docs-link-ai-summary').textContent).toMatch(
      /help/i,
    );
  });

  it('honours className and testId overrides', async () => {
    await renderWith(
      'en',
      <DocsLink slug="troubleshooting" className="custom-cls" testId="my-id" />,
    );
    const anchor = screen.getByTestId('my-id');
    expect(anchor.className).toBe('custom-cls');
  });
});
