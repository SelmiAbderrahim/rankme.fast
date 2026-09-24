import type { CSSProperties } from 'react';
import { cn } from '@shared/lib/utils';
import type { SupportedLocale } from '@shared/i18n/locales';

export const BRAND_NAME = 'RankMeFast';
export const BRAND_DOMAIN = 'rankme.fast';
export const BRAND_TAGLINE = 'Plain-language SEO and AI-answer-engine audits.';
export const BRAND_SOCIAL_HANDLE = '@rankmefast';
/** Support mailbox — Terms contact and the bug-report fallback without a public repo. */
export const BRAND_SUPPORT_EMAIL = 'support@rankme.fast';
/** Maintainer contact for bug reports, fixes, and questions (footer + self-host band). */
export const MAINTAINER_X_HANDLE = '@rahim_selmi';
export const MAINTAINER_X_URL = 'https://x.com/rahim_selmi';
export const BRAND_THEME_COLOR = '#1c1a18';
export const BRAND_PRIMARY_COLOR = '#1c1a18';

export const brandManifestPath = (locale: SupportedLocale): string =>
  `/site.${locale}.webmanifest`;

export const BRAND_ASSETS = {
  favicon: '/favicon.svg',
  manifest: '/site.webmanifest',
  maskIcon: '/safari-pinned-tab.svg',
  mark: '/brand/rankmefast-mark.svg',
  logo: '/brand/rankmefast-logo.svg',
  appleTouchIcon: '/apple-touch-icon.png',
  favicon16: '/icons/favicon-16.png',
  favicon32: '/icons/favicon-32.png',
  icon192: '/icons/icon-192.png',
  icon512: '/icons/icon-512.png',
  ogDefault: '/og/default.png',
  ogLogo: '/og/logo.png',
} as const;

interface BrandLogoProps {
  className?: string;
  markOnly?: boolean;
  style?: CSSProperties;
  /** Extra classes on the wordmark span (e.g. hide it when the sidebar collapses). */
  textClassName?: string;
}

export const BrandLogo = ({
  className,
  markOnly = false,
  style,
  textClassName,
}: BrandLogoProps) => (
  <span
    className={cn(
      'brand-logo inline-flex items-center gap-2 leading-none whitespace-nowrap text-inherit no-underline',
      className,
    )}
    style={style}
    aria-label={markOnly ? BRAND_NAME : undefined}
    role={markOnly ? 'img' : undefined}
  >
    <svg
      className="brand-logo__mark text-primary size-8 shrink-0"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path
        d="M16 18h14M16 25h9"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect
        x="17"
        y="39"
        width="8"
        height="10"
        rx="2.5"
        fill="var(--primary-foreground)"
        opacity="0.72"
      />
      <rect x="29" y="31" width="8" height="18" rx="2.5" fill="var(--primary-foreground)" />
      <rect x="41" y="22" width="8" height="27" rx="2.5" fill="var(--primary-foreground)" />
    </svg>
    {!markOnly && (
      <span className={cn('brand-logo__text text-lg font-bold tracking-normal', textClassName)}>
        {BRAND_NAME}
      </span>
    )}
  </span>
);
