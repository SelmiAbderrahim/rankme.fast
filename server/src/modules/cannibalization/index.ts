export { createCannibalizationReportRouter, createCannibalizationSiteRouter, } from './cannibalization.routes.js';
export { CannibalizationReport, type CannibalizationReportDocument, } from './cannibalization.model.js';
export { computeReport, generateReport, getReport, listReports, previewReport, resolveOwnedCannibalizationReportSiteId, CANNIBALIZATION_DIMENSION_SET, type CandidateDto, type CandidatePageDto, type ReportDetailDto, type ReportSummaryDto, } from './cannibalization.service.js';
export { setCannibalizationDb, getCannibalizationDb, } from './cannibalization.holder.js';
export { CANNIBALIZATION_WINDOWS, DEFAULT_CANNIBALIZATION_WINDOW, MAX_CANDIDATES, MAX_PAGES_PER_QUERY, type CannibalizationWindow, } from './cannibalization.schema.js';
export { createCannibalizationReportExportAdapter } from './report-export.adapter.js';
