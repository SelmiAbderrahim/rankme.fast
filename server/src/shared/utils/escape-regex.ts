/**
 * Escape a user-supplied string for safe use inside a MongoDB `$regex` filter.
 *
 * Without this, search input like `a+b@x.com` is interpreted as a regular
 * expression and can throw (or match unexpectedly). Every admin/superadmin
 * search surface that feeds free text into `$regex` MUST route it through here.
 */
export function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
