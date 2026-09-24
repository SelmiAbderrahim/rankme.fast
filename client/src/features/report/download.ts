/**
 * Backward-compatible report download helper. New export surfaces own the
 * implementation, while the report module keeps its established import path.
 */
export { filenameFromContentDisposition, saveBlobAs } from '@features/report-export';
