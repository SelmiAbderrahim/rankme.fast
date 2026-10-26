import type { ComponentProps } from 'react';

/** Clip the wrapper: a table itself cannot shrink below its content width. */
export const ScreenReaderTable = (props: ComponentProps<'table'>) => (
  <div data-slot="screen-reader-table" className="sr-only">
    <table {...props} />
  </div>
);
