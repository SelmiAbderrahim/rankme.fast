import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../i18n/index.js';
import {
  escapeEmailHtml,
  renderEmailAction,
  renderEmailTemplate,
} from './email-template.js';

describe('renderEmailTemplate', () => {
  it.each(SUPPORTED_LOCALES)('renders the shared shell in %s', (locale) => {
    const html = renderEmailTemplate({
      subject: `Subject <${locale}>`,
      text: `Body <script>alert("${locale}")</script> & details`,
      locale,
    });

    const rtl = locale === 'ar';
    expect(html).toContain(`<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">`);
    expect(html).toContain(`text-align:${rtl ? 'right' : 'left'}`);
    expect(html).toContain(`${rtl ? 'border-right' : 'border-left'}:4px solid #b5321e`);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('background-color:#f2f0ed');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain('background-color:#0a0a09!important');
    expect(html).toContain('/fonts/inter-latin-400-normal.woff2');
    expect(html).toContain(`Subject &lt;${locale}&gt;`);
    expect(html).toContain(`Body &lt;script&gt;alert(&quot;${locale}&quot;)&lt;/script&gt; &amp; details`);
    expect(html).not.toContain(`<script>alert("${locale}")</script>`);
  });

  it('falls back to the configured locale and keeps escaped feature markup', () => {
    const bodyHtml = `<p>${escapeEmailHtml('<Client & Co>')}</p>`;
    const html = renderEmailTemplate({
      subject: 'Report',
      text: '<Client & Co>',
      locale: 'unsupported',
      bodyHtml,
    });

    expect(html).toContain(`<html lang="${env.DEFAULT_LOCALE}"`);
    expect(html).toContain(bodyHtml);
    expect(html).not.toContain('<Client & Co>');
  });

  it('renders the two theme-approved action variants with escaped values', () => {
    const primary = renderEmailAction('Open <report>', 'https://app.test/a?x=1&y=2', 'primary');
    const destructive = renderEmailAction('Reject', 'https://app.test/reject', 'destructive');

    expect(primary).toContain('class="email-primary-action"');
    expect(primary).toContain('background-color:#1c1a18');
    expect(primary).toContain('Open &lt;report&gt;');
    expect(primary).toContain('href="https://app.test/a?x=1&amp;y=2"');
    expect(destructive).toContain('class="email-destructive-action"');
    expect(destructive).toContain('border:1px solid #b91c1c');
    expect(destructive).toContain('border-radius:6px');
  });
});
