import sharp, { type Metadata, type Sharp } from 'sharp';
import { HttpError } from '../../shared/utils/http-error.js';

export const BRANDING_LOGO_MAX_INPUT_BYTES = 256 * 1024;
export const BRANDING_LOGO_MAX_OUTPUT_BYTES = 512 * 1024;
export const BRANDING_LOGO_MAX_DIMENSION_PX = 1_024;
export const BRANDING_LOGO_MAX_PIXELS = 1_048_576;
export const BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX = 512;

/**
 * Accepted upload formats. Every one is decoded, checked
 * against its declared type, and re-encoded as PNG before storage, so the
 * stored logo, the PDF embed (`embedPng`) and the portal data URL stay PNG.
 * SVG is rasterized here and never stored or served as SVG.
 */
const LOGO_FORMATS = {
  png: 'data:image/png;base64,',
  jpeg: 'data:image/jpeg;base64,',
  svg: 'data:image/svg+xml;base64,',
} as const;
type LogoFormat = keyof typeof LOGO_FORMATS;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_CHUNK_TYPE = /^[A-Za-z]{4}$/;

/** The document must open with `<svg`, after an optional XML declaration and comments. */
const SVG_ROOT = /^\uFEFF?\s*(?:<\?xml\s[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/;
/**
 * Anything that can run code, pull in another document, or expand entities.
 * librsvg runs no script and the raster is all we keep, but an SVG that asks
 * for any of this is rejected outright rather than partly drawn.
 */
const SVG_UNSAFE: readonly RegExp[] = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<\?xml-stylesheet/i,
  /<\s*script[\s>/]/i,
  /<\s*foreignObject[\s>/]/i,
  /\son[a-z]+\s*=/i,
  /\s(?:[\w.-]+:)?href\s*=\s*(?!["']#)/i,
  /url\(\s*(?!["']?#)/i,
  /@import/i,
];

export interface NormalizedBrandingLogo {
  logoPngBase64: string;
  logoWidth: number;
  logoHeight: number;
}

function malformed(_cause?: unknown): HttpError {
  return HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_MALFORMED', messageKey: 'branding.errors.logoMalformed' });
}

/**
 * Validate the complete PNG envelope before decoding. In particular IEND must
 * be the final byte range, so an otherwise-decodable PNG with an appended ZIP,
 * script, or second file is rejected rather than silently normalized.
 */
export function assertCompletePngEnvelope(bytes: Buffer): void {
  if (bytes.length < PNG_SIGNATURE.length + 12 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw malformed();
  }

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw malformed();
    const dataLength = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + dataLength;
    if (!PNG_CHUNK_TYPE.test(type) || end > bytes.length) throw malformed();
    if (chunkIndex === 0 && (type !== 'IHDR' || dataLength !== 13)) throw malformed();
    if (type === 'IHDR' && chunkIndex !== 0) throw malformed();
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (dataLength !== 0 || !sawIdat || end !== bytes.length) throw malformed();
      sawIend = true;
    }
    offset = end;
    chunkIndex += 1;
  }
  if (!sawIend) throw malformed();
}

/**
 * A JPEG must start with SOI and end with EOI, so a file with another file
 * appended (a polyglot) is rejected like a PNG with bytes after IEND.
 */
export function assertCompleteJpegEnvelope(bytes: Buffer): void {
  if (
    bytes.length < JPEG_START.length + JPEG_END.length ||
    !bytes.subarray(0, JPEG_START.length).equals(JPEG_START) ||
    !bytes.subarray(bytes.length - JPEG_END.length).equals(JPEG_END)
  ) {
    throw malformed();
  }
}

/** UTF-8 text with an `<svg>` root and none of the `SVG_UNSAFE` constructs. */
export function assertSafeSvgSource(bytes: Buffer): void {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw malformed(error);
  }
  if (text.includes('\u0000')) throw malformed();
  // Unsafe constructs first, so an SVG with a DOCTYPE or entities gets the
  // specific explanation rather than a generic "not a valid logo".
  if (SVG_UNSAFE.some((pattern) => pattern.test(text))) {
    throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_UNSAFE_SVG', messageKey: 'branding.errors.logoUnsafeSvg' });
  }
  if (!SVG_ROOT.test(text)) throw malformed();
}

function decodeLogoDataUrl(dataUrl: string): { format: LogoFormat; bytes: Buffer } {
  const format = (Object.keys(LOGO_FORMATS) as LogoFormat[]).find((key) =>
    dataUrl.startsWith(LOGO_FORMATS[key]),
  );
  if (format === undefined) throw malformed();
  const encoded = dataUrl.slice(LOGO_FORMATS[format].length);
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    throw malformed();
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw malformed();
  if (bytes.length > BRANDING_LOGO_MAX_INPUT_BYTES) {
    throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_TOO_LARGE', messageKey: 'branding.errors.logoTooLarge' });
  }
  return { format, bytes };
}

/** The declared type's own envelope check, before any decoder sees the bytes. */
const ENVELOPE_CHECKS: Record<LogoFormat, (bytes: Buffer) => void> = {
  png: assertCompletePngEnvelope,
  jpeg: assertCompleteJpegEnvelope,
  svg: assertSafeSvgSource,
};

/**
 * SVG is drawn at a density that fits its longer side into the stored size,
 * so a small vector logo stays sharp instead of being stored at icon size.
 */
function svgDensity(width: number, height: number): number {
  return Math.min(72 * 8, (72 * BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX) / Math.max(width, height));
}

const encodePng = (image: Sharp, palette: boolean) =>
  image
    .png({ adaptiveFiltering: false, compressionLevel: 9, effort: 10, palette })
    .toBuffer({ resolveWithObject: true });

/** Decode, validate, resize, metadata-strip, and deterministically re-encode as PNG. */
export async function normalizeBrandingLogo(
  dataUrl: string,
): Promise<NormalizedBrandingLogo> {
  const { format, bytes: input } = decodeLogoDataUrl(dataUrl);
  ENVELOPE_CHECKS[format](input);

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      animated: false,
      failOn: 'error',
      limitInputPixels: BRANDING_LOGO_MAX_PIXELS + 1,
    }).metadata();
  } catch (error) {
    throw malformed(error);
  }
  // A file whose bytes are another format than its declared type is refused.
  if (metadata.format !== format) throw malformed();

  const width = metadata.width;
  const height = metadata.height;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > BRANDING_LOGO_MAX_DIMENSION_PX ||
    height > BRANDING_LOGO_MAX_DIMENSION_PX ||
    width * height > BRANDING_LOGO_MAX_PIXELS ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_DIMENSIONS', messageKey: 'branding.errors.logoDimensions' });
  }

  try {
    const prepare = () => {
      const image = sharp(input, {
        animated: false,
        failOn: 'error',
        limitInputPixels: BRANDING_LOGO_MAX_PIXELS + 1,
        ...(format === 'svg' ? { density: svgDensity(width, height) } : {}),
      });
      // A photo's EXIF orientation is applied before the metadata is dropped.
      if (format === 'jpeg') image.rotate();
      return image.ensureAlpha().resize({
        width: BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX,
        height: BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    };
    let output = await encodePng(prepare(), false);
    // A photographic JPEG can outgrow the lossless budget; a quantized
    // palette keeps it within the cap without dropping the logo.
    if (output.data.length > BRANDING_LOGO_MAX_OUTPUT_BYTES) {
      output = await encodePng(prepare(), true);
    }
    if (output.data.length > BRANDING_LOGO_MAX_OUTPUT_BYTES) {
      throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_TOO_LARGE', messageKey: 'branding.errors.logoTooLarge' });
    }
    assertCompletePngEnvelope(output.data);
    return {
      logoPngBase64: output.data.toString('base64'),
      logoWidth: output.info.width,
      logoHeight: output.info.height,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw malformed(error);
  }
}
