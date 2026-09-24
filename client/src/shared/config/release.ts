/**
 * Release stage for the shared chrome (banner + header badge).
 *
 * Baked at build time from `VITE_RELEASE_STAGE` (root `.env`). Only `beta` and
 * `ga` are recognised; blank or unknown values resolve to `beta`, so a missing
 * variable can never silently hide the beta notice. Ending the beta is a
 * single `VITE_RELEASE_STAGE=ga` flip and rebuild.
 */
export type ReleaseStage = 'beta' | 'ga';

export function releaseStage(): ReleaseStage {
  const configured = (import.meta.env.VITE_RELEASE_STAGE as string | undefined)
    ?.trim()
    .toLowerCase();
  return configured === 'ga' ? 'ga' : 'beta';
}

export function isBeta(): boolean {
  return releaseStage() === 'beta';
}
