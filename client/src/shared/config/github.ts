import { BRAND_SUPPORT_EMAIL } from '@shared/brand';

/**
 * Public GitHub repository URL for the open-source marketing elements.
 *
 * Baked at build time from `VITE_GITHUB_URL` (root `.env`). Blank or invalid
 * values resolve to `null` and every open-source UI element (header chip,
 * license badge, clone command line) renders nothing — never a dead link or a
 * "coming soon" stub. Flipping the env var and rebuilding is the entire
 * open-source launch switch.
 */
export function githubUrl(): string | null {
  const configured = import.meta.env.VITE_GITHUB_URL as string | undefined;
  if (!configured) return null;

  try {
    return new URL(configured).toString();
  } catch {
    return null;
  }
}

/** The repository's "new issue" chooser, or `null` while no repository is public. */
export function githubIssuesUrl(): string | null {
  const repo = githubUrl();
  if (!repo) return null;
  return `${repo.replace(/\/+$/u, '')}/issues/new/choose`;
}

/**
 * Where a visitor reports a bug: the public issue chooser once the repository
 * is set, otherwise the support mailbox. Never `#`.
 */
export function bugReportHref(): string {
  return githubIssuesUrl() ?? `mailto:${BRAND_SUPPORT_EMAIL}`;
}
