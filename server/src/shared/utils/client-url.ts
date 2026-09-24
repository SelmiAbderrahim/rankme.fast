import { env } from '../../config/env.js';
/**
 * Public origin without the trailing slash. Used to build outbound URLs
 * (team invite link, communication CTAs) so a stray "/" in `CLIENT_URL`
 * never becomes "//" in a link.
 */
export function normalizedClientUrl(): string {
    return env.CLIENT_URL.replace(/\/$/, '');
}
/** Authenticated application origin without a trailing slash. */
export function normalizedAppUrl(): string {
    return env.APP_URL.replace(/\/$/, '');
}
