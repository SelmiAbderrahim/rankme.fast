import sharp, { type Metadata } from 'sharp';
import { HttpError } from '../../shared/utils/http-error.js';
export const BRANDING_LOGO_MAX_INPUT_BYTES = 256 * 1024;
export const BRANDING_LOGO_MAX_OUTPUT_BYTES = 512 * 1024;
export const BRANDING_LOGO_MAX_DIMENSION_PX = 1024;
export const BRANDING_LOGO_MAX_PIXELS = 1048576;
export const BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX = 512;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_CHUNK_TYPE = /^[A-Za-z]{4}$/;
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
        if (offset + 12 > bytes.length)
            throw malformed();
        const dataLength = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const end = offset + 12 + dataLength;
        if (!PNG_CHUNK_TYPE.test(type) || end > bytes.length)
            throw malformed();
        if (chunkIndex === 0 && (type !== 'IHDR' || dataLength !== 13))
            throw malformed();
        if (type === 'IHDR' && chunkIndex !== 0)
            throw malformed();
        if (type === 'IDAT')
            sawIdat = true;
        if (type === 'IEND') {
            if (dataLength !== 0 || !sawIdat || end !== bytes.length)
                throw malformed();
            sawIend = true;
        }
        offset = end;
        chunkIndex += 1;
    }
    if (!sawIend)
        throw malformed();
}
function decodeLogoDataUrl(dataUrl: string): Buffer {
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX))
        throw malformed();
    const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
    if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
        throw malformed();
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded)
        throw malformed();
    if (bytes.length > BRANDING_LOGO_MAX_INPUT_BYTES) {
        throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_TOO_LARGE', messageKey: 'branding.errors.logoTooLarge' });
    }
    return bytes;
}
/** Decode, validate, resize, metadata-strip, and deterministically re-encode. */
export async function normalizeBrandingLogo(dataUrl: string): Promise<NormalizedBrandingLogo> {
    const input = decodeLogoDataUrl(dataUrl);
    assertCompletePngEnvelope(input);
    let metadata: Metadata;
    try {
        metadata = await sharp(input, {
            animated: false,
            failOn: 'error',
            limitInputPixels: BRANDING_LOGO_MAX_PIXELS + 1,
        }).metadata();
    }
    catch (error) {
        throw malformed(error);
    }
    const width = metadata.width;
    const height = metadata.height;
    if (width === undefined ||
        height === undefined ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > BRANDING_LOGO_MAX_DIMENSION_PX ||
        height > BRANDING_LOGO_MAX_DIMENSION_PX ||
        width * height > BRANDING_LOGO_MAX_PIXELS ||
        (metadata.pages ?? 1) !== 1) {
        throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_DIMENSIONS', messageKey: 'branding.errors.logoDimensions' });
    }
    try {
        const output = await sharp(input, {
            animated: false,
            failOn: 'error',
            limitInputPixels: BRANDING_LOGO_MAX_PIXELS + 1,
        })
            .ensureAlpha()
            .resize({
            width: BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX,
            height: BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
        })
            .png({
            adaptiveFiltering: false,
            compressionLevel: 9,
            effort: 10,
            palette: false,
        })
            .toBuffer({ resolveWithObject: true });
        if (output.data.length > BRANDING_LOGO_MAX_OUTPUT_BYTES) {
            throw HttpError.badRequest({ code: 'BRANDING_ERRORS_LOGO_TOO_LARGE', messageKey: 'branding.errors.logoTooLarge' });
        }
        assertCompletePngEnvelope(output.data);
        return {
            logoPngBase64: output.data.toString('base64'),
            logoWidth: output.info.width,
            logoHeight: output.info.height,
        };
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw malformed(error);
    }
}
