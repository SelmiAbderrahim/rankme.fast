import { env } from '../../config/env.js';
import { isSupportedLocale, type SupportedLocale } from '../i18n/index.js';
import { normalizedClientUrl } from './client-url.js';
// Email clients cannot resolve the browser's CSS variables. These values mirror
// the semantic light/dark roles in client/src/styles/tailwind.css.
const EMAIL_THEME = {
    light: {
        background: '#f2f0ed',
        card: '#ffffff',
        foreground: '#191715',
        primary: '#1c1a18',
        primaryForeground: '#f5f3f0',
        mutedForeground: '#59544f',
        highlight: '#b5321e',
        border: '#c8c1b8',
        destructive: '#b91c1c',
    },
    dark: {
        background: '#0a0a09',
        card: '#141312',
        foreground: '#f2f0ed',
        primary: '#f2f0ed',
        primaryForeground: '#12100f',
        mutedForeground: '#a39f99',
        highlight: '#ff5c3f',
        border: '#3d3833',
        destructive: '#f87171',
    },
} as const;
export interface EmailTemplateInput {
    subject: string;
    text: string;
    locale?: string;
    /** Feature-owned markup whose interpolated values have already been escaped. */
    bodyHtml?: string;
}
export type EmailActionVariant = 'primary' | 'destructive';
export function escapeEmailHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
export function renderEmailAction(label: string, href: string, variant: EmailActionVariant): string {
    const primary = variant === 'primary';
    const className = primary ? 'email-primary-action' : 'email-destructive-action';
    const style = primary
        ? `background-color:${EMAIL_THEME.light.primary};border:1px solid ${EMAIL_THEME.light.primary};color:${EMAIL_THEME.light.primaryForeground}`
        : `background-color:transparent;border:1px solid ${EMAIL_THEME.light.destructive};color:${EMAIL_THEME.light.destructive}`;
    return `<a class="${className}" href="${escapeEmailHtml(href)}" style="${style};border-radius:6px;display:inline-block;font-size:14px;font-weight:600;line-height:1.25;margin:4px;padding:12px 18px;text-decoration:none">${escapeEmailHtml(label)}</a>`;
}
function resolveEmailLocale(locale: string | undefined): SupportedLocale {
    return isSupportedLocale(locale) ? locale : env.DEFAULT_LOCALE;
}
export function renderEmailTemplate(input: EmailTemplateInput): string {
    const locale = resolveEmailLocale(input.locale);
    const rtl = locale === 'ar';
    const direction = rtl ? 'rtl' : 'ltr';
    const textAlign = rtl ? 'right' : 'left';
    const accentBorder = rtl ? 'border-right' : 'border-left';
    const clientUrl = normalizedClientUrl();
    const clientOrigin = new URL(clientUrl).origin;
    const regularFontUrl = new URL('/fonts/inter-latin-400-normal.woff2', clientOrigin).href;
    const semiboldFontUrl = new URL('/fonts/inter-latin-600-normal.woff2', clientOrigin).href;
    const subject = escapeEmailHtml(input.subject);
    const body = input.bodyHtml ??
        `<div style="white-space:pre-wrap">${escapeEmailHtml(input.text)}</div>`;
    return `<!doctype html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    @font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:swap;src:url('${regularFontUrl}') format('woff2')}
    @font-face{font-family:Inter;font-style:normal;font-weight:600;font-display:swap;src:url('${semiboldFontUrl}') format('woff2')}
    @media (prefers-color-scheme:dark){
      .email-page{background-color:${EMAIL_THEME.dark.background}!important}
      .email-card{background-color:${EMAIL_THEME.dark.card}!important;border-color:${EMAIL_THEME.dark.border}!important}
      .email-copy,.email-heading,.email-brand{color:${EMAIL_THEME.dark.foreground}!important}
      .email-muted{color:${EMAIL_THEME.dark.mutedForeground}!important}
      .email-divider{border-color:${EMAIL_THEME.dark.border}!important}
      .email-accent{border-color:${EMAIL_THEME.dark.highlight}!important}
      .email-primary-action{background-color:${EMAIL_THEME.dark.primary}!important;color:${EMAIL_THEME.dark.primaryForeground}!important}
      .email-destructive-action{border-color:${EMAIL_THEME.dark.destructive}!important;color:${EMAIL_THEME.dark.destructive}!important}
    }
  </style>
</head>
<body class="email-page" dir="${direction}" style="margin:0;background-color:${EMAIL_THEME.light.background};color:${EMAIL_THEME.light.foreground};font-family:Inter,Arial,sans-serif;text-align:${textAlign}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${subject}</div>
  <table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:${EMAIL_THEME.light.background}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:${EMAIL_THEME.light.card};border:1px solid ${EMAIL_THEME.light.border};border-radius:12px">
          <tr>
            <td class="email-accent" style="padding:24px 28px;${accentBorder}:4px solid ${EMAIL_THEME.light.highlight};text-align:${textAlign}">
              <a class="email-brand" href="${escapeEmailHtml(clientUrl)}" style="color:${EMAIL_THEME.light.foreground};font-size:18px;font-weight:600;line-height:1.25;text-decoration:none">RankMeFast</a>
            </td>
          </tr>
          <tr>
            <td class="email-divider" style="border-top:1px solid ${EMAIL_THEME.light.border};padding:28px;text-align:${textAlign}">
              <h1 class="email-heading" style="margin:0 0 20px;color:${EMAIL_THEME.light.foreground};font-size:24px;font-weight:600;line-height:1.3">${subject}</h1>
              <div class="email-copy" dir="${direction}" style="color:${EMAIL_THEME.light.foreground};font-size:16px;line-height:1.65;overflow-wrap:anywhere;text-align:${textAlign}">${body}</div>
            </td>
          </tr>
          <tr>
            <td class="email-divider email-muted" style="border-top:1px solid ${EMAIL_THEME.light.border};padding:20px 28px;color:${EMAIL_THEME.light.mutedForeground};font-size:13px;line-height:1.5;text-align:${textAlign}">
              <a class="email-muted" href="${escapeEmailHtml(clientUrl)}" style="color:${EMAIL_THEME.light.mutedForeground};text-decoration:none">rankme.fast</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
