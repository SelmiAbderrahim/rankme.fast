/** Trigger a download for the already-neutralized server CSV response. */
export function downloadInternalLinkCsv(filename: string, contents: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  // Fetch's text decoder consumes a leading UTF-8 BOM. Restore it for the
  // browser download so the seven-locale CSV keeps the serializer's Excel
  // encoding guarantee, while avoiding a duplicate for direct callers.
  const downloadableContents = contents.charCodeAt(0) === 0xfeff ? contents : `\ufeff${contents}`;
  const url = URL.createObjectURL(
    new Blob([downloadableContents], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
