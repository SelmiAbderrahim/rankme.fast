/**
 * Compatibility façade for the shipped audit PDF renderer.
 * Font selection and loading now live in the shared report-export PDF layer.
 */
import type { SupportedLocale } from '../../../shared/i18n/index.js';
import { readReportPdfFont, reportPdfFontFiles, type PdfFontFile, } from '../../../shared/report-exports/pdf-support.js';
export type { PdfFontFile };
export interface LocaleFontFiles {
    regular: PdfFontFile;
    bold: PdfFontFile;
}
export function readPdfFont(file: PdfFontFile): Uint8Array {
    return readReportPdfFont(file);
}
export function fontFilesFor(locale: SupportedLocale): LocaleFontFiles {
    return reportPdfFontFiles(locale);
}
