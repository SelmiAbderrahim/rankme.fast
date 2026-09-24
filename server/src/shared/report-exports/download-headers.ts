import { REPORT_FORMAT_EXTENSIONS, REPORT_FORMAT_MEDIA_TYPES, } from './contracts.js';
import type { ReportFormat } from './catalog.js';
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
// eslint-disable-next-line no-control-regex -- filename sanitization must explicitly replace C0/C1 controls
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f"\\/:*?<>|]/gu;
const COMBINING_MARKS = /\p{Mark}+/gu;
const WHITESPACE = /\s+/gu;
const DASHES = /-+/gu;
const MAX_FILENAME_BYTES = 96;
function trimUtf8(value: string, maxBytes: number): string {
    let result = '';
    for (const character of value) {
        if (Buffer.byteLength(result + character, 'utf8') > maxBytes)
            break;
        result += character;
    }
    return result;
}
function safeStem(value: string): string {
    const normalized = value
        .normalize('NFKC')
        .replace(BIDI_CONTROLS, '')
        .replace(UNSAFE_FILENAME_CHARS, '-')
        .replace(WHITESPACE, '-')
        .replace(DASHES, '-')
        .replace(/^[-.]+|[-.]+$/gu, '');
    return normalized || 'report';
}
function asciiFallback(value: string): string {
    const ascii = safeStem(value)
        .normalize('NFKD')
        .replace(COMBINING_MARKS, '')
        .replace(/[^a-zA-Z0-9._-]/gu, '-')
        .replace(DASHES, '-')
        .replace(/^[-.]+|[-.]+$/gu, '');
    return ascii || 'report';
}
function encodeRfc5987(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
export interface SafeReportFilenameInput {
    stem: string;
    sourceDate: string;
    format: ReportFormat;
    duplicateIndex?: number;
}
export interface SafeReportFilename {
    filename: string;
    asciiFilename: string;
    contentDisposition: string;
}
/**
 * Produce a bounded attachment name and its RFC 6266/RFC 5987 header value.
 * Caller text can influence the stem only as data; path segments, controls,
 * quotes, bidi overrides, and CR/LF are removed before header construction.
 */
export function createSafeReportFilename(input: SafeReportFilenameInput): SafeReportFilename {
    const extension = REPORT_FORMAT_EXTENSIONS[input.format];
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(input.sourceDate)
        ? input.sourceDate
        : 'undated';
    const suffix = input.duplicateIndex && input.duplicateIndex > 1
        ? `-${Math.trunc(input.duplicateIndex)}`
        : '';
    const prefix = 'rankmefast-';
    const reservedBytes = Buffer.byteLength(`${prefix}-${date}${suffix}.${extension}`, 'utf8');
    const unicodeStem = trimUtf8(safeStem(input.stem), MAX_FILENAME_BYTES - reservedBytes);
    const fallbackStem = trimUtf8(asciiFallback(input.stem), MAX_FILENAME_BYTES - reservedBytes);
    const filename = `${prefix}${unicodeStem}-${date}${suffix}.${extension}`;
    const asciiFilename = `${prefix}${fallbackStem}-${date}${suffix}.${extension}`;
    return {
        filename,
        asciiFilename,
        contentDisposition: `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRfc5987(filename)}`,
    };
}
export interface ReportDownloadHeaders {
    readonly 'Cache-Control': 'private, no-store';
    readonly 'Content-Disposition': string;
    readonly 'Content-Length': string;
    readonly 'Content-Type': string;
    readonly 'X-Content-Type-Options': 'nosniff';
}
/** Build the complete allowlisted response-header set for a downloaded file. */
export function createReportDownloadHeaders(input: {
    filename: SafeReportFilename;
    format: ReportFormat;
    byteLength: number;
}): ReportDownloadHeaders {
    if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
        throw new RangeError('invalid report byte length');
    }
    return Object.freeze({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': input.filename.contentDisposition,
        'Content-Length': String(input.byteLength),
        'Content-Type': REPORT_FORMAT_MEDIA_TYPES[input.format],
        'X-Content-Type-Options': 'nosniff',
    });
}
