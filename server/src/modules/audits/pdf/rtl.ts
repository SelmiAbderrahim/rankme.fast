/**
 * Compatibility façade for the audit renderer's Arabic shaping contract.
 * The implementation is shared by every report PDF representation.
 */
export { containsReportArabic as containsArabic, shapeReportArabic as shapeArabic, toVisualReportRtlLine as toVisualRtlLine, } from '../../../shared/report-exports/pdf-support.js';
