/** Minimum phone height for controls outside the shared primitives. */
export const TAP_TARGET = 'max-md:min-h-11';
export const TAP_TARGET_LINK = 'max-md:inline-flex max-md:min-h-11 max-md:items-center';
/** A centered hit area inside a relatively positioned control. */
export const TapHitArea = () => (
  <span
    data-slot="hit-area"
    aria-hidden="true"
    className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 max-md:size-11"
  />
);
