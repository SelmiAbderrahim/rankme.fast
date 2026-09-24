import { beforeEach, describe, expect, it } from 'vitest';
import { REPORT_FORMAT_EXTENSIONS, REPORT_FORMAT_MEDIA_TYPES, REPORT_LOCALES, getReportCatalogDescriptor, reportExportAdapterResultSchema, reportLocaleSchema, reportRenderedResultSchema, type ReportBrandingSnapshot, type ReportLocale, type ReportSelection, } from '../../../shared/report-exports/index.js';
import { ReportExportAdapterRegistry } from '../report-exports.registry.js';
import { stableReportJson } from '../report-exports.service.js';
import type { ReportExportAccessContext, ReportExportAdapter, ReportExportComposeContext, } from '../report-exports.types.js';
export interface ReportExportSpendCounters {
    provider: number;
    queue: number;
}
export interface ReportExportAdapterContractFixture {
    adapter: ReportExportAdapter;
    allowedAccess: ReportExportAccessContext;
    foreignAccess: ReportExportAccessContext;
    branding: ReportBrandingSnapshot;
    selection: ReportSelection;
    composeContext(locale: ReportLocale): ReportExportComposeContext;
    refuseIncomplete(): Promise<void>;
    spendCounters(): ReportExportSpendCounters;
}
/**
 * Reusable acceptance suite for every production adapter added by later
 * prompts. The fixture owns its source data; this
 * harness owns the cross-adapter invariants.
 */
export function defineReportExportAdapterContract(name: string, createFixture: () => ReportExportAdapterContractFixture): void {
    describe(`${name} report-export adapter contract`, () => {
        let fixture: ReportExportAdapterContractFixture;
        beforeEach(() => {
            fixture = createFixture();
        });
        it('registers one known kind with the catalog format truth', () => {
            const descriptor = getReportCatalogDescriptor(fixture.adapter.kind);
            expect(descriptor).toBeDefined();
            expect(fixture.adapter.supportedFormats).toEqual(descriptor?.formats);
            const registry = new ReportExportAdapterRegistry();
            registry.register(fixture.adapter);
            expect(registry.listAvailableKinds()).toEqual([fixture.adapter.kind]);
            expect(() => registry.register(fixture.adapter)).toThrow(/duplicate/u);
        });
        it('enforces owner access', async () => {
            await expect(fixture.adapter.assertAccess(fixture.allowedAccess)).resolves.toBeUndefined();
            await expect(fixture.adapter.assertAccess(fixture.foreignAccess)).rejects.toMatchObject({ status: 404 });
        });
        it('composes every supported locale deterministically', async () => {
            expect(reportLocaleSchema.safeParse('it').success).toBe(false);
            for (const locale of REPORT_LOCALES) {
                const context = fixture.composeContext(locale);
                const first = reportExportAdapterResultSchema.parse(await fixture.adapter.compose(context));
                const second = reportExportAdapterResultSchema.parse(await fixture.adapter.compose(context));
                expect(first.document.locale).toBe(locale);
                expect(stableReportJson(first)).toBe(stableReportJson(second));
                expect(first.document.completeness.selectedItems).toBe(first.document.completeness.representedItems);
            }
        });
        it('refuses a scope it cannot represent completely', async () => {
            await expect(fixture.refuseIncomplete()).rejects.toMatchObject({
                status: 422,
            });
        });
        it('renders every advertised format deterministically without spend', async () => {
            const composed = reportExportAdapterResultSchema.parse(await fixture.adapter.compose(fixture.composeContext('en')));
            for (const format of fixture.adapter.supportedFormats) {
                const context = {
                    document: composed.document,
                    format,
                    snapshotCreatedAt: '2026-08-08T12:00:00.000Z',
                } as const;
                const first = reportRenderedResultSchema.parse(await fixture.adapter.render(context));
                const second = reportRenderedResultSchema.parse(await fixture.adapter.render(context));
                expect(first.mediaType).toBe(REPORT_FORMAT_MEDIA_TYPES[format]);
                expect(first.extension).toBe(REPORT_FORMAT_EXTENSIONS[format]);
                expect(Buffer.from(first.bytes)).toEqual(Buffer.from(second.bytes));
            }
            expect(fixture.spendCounters()).toEqual({
                provider: 0,
                queue: 0,
            });
        });
    });
}
