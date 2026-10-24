/**
 * Human label for a site in pickers, tables and menus.
 *
 * `displayName` is optional by design: a site added without a custom name has
 * an empty string, so every surface must fall back to the domain. Rendering
 * `displayName` alone produced blank options (an empty, unselectable-looking
 * row in a Radix `Select`). Whitespace-only names count as empty.
 */
export interface SiteLabelSource {
  displayName?: string | null;
  domain: string;
  paused?: boolean;
}

export const siteLabel = (site: SiteLabelSource): string => site.displayName?.trim() || site.domain;
