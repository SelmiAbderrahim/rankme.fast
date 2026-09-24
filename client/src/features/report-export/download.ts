const FALLBACK_FILENAME = 'rankmefast-report';

function cleanFilename(value: string): string {
  const basename = value.replace(/^.*[\\/]/u, '');
  const cleaned = [...basename]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .replace(/[<>:"|?*]/gu, '-')
    .trim();
  return cleaned || FALLBACK_FILENAME;
}

export function filenameFromContentDisposition(
  contentDisposition: string | null,
  fallback = FALLBACK_FILENAME,
): string {
  if (!contentDisposition) return cleanFilename(fallback);
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(contentDisposition)?.[1];
  if (encoded) {
    try {
      return cleanFilename(decodeURIComponent(encoded));
    } catch {
      // Fall through to the ASCII filename parameter.
    }
  }
  const quoted = /filename="((?:\\.|[^"])*)"/iu.exec(contentDisposition)?.[1];
  if (quoted) return cleanFilename(quoted.replace(/\\([\\"])/gu, '$1'));
  const plain = /filename=([^;]+)/iu.exec(contentDisposition)?.[1];
  return cleanFilename(plain?.trim() || fallback);
}

export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = cleanFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
