import { describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  REPORT_CATALOG,
  reportSelectionSchema,
} from "../../shared/report-exports/index.js";
import { createCoreReportExportAdapterRegistry } from "./report-exports.registry.js";

describe("production report-export adapter registry", () => {
  it("registers every catalog kind once, in canonical order, with matching closed contracts", () => {
    const registry = createCoreReportExportAdapterRegistry(db);
    const kinds = registry.listAvailableKinds();
    expect(kinds).toEqual(REPORT_CATALOG.map((descriptor) => descriptor.kind));
    expect(kinds).toHaveLength(44);
    expect(new Set(kinds).size).toBe(44);

    for (const descriptor of REPORT_CATALOG) {
      const adapter = registry.get(descriptor.kind);
      expect(adapter, descriptor.kind).toBeDefined();
      expect(adapter?.kindVersion, descriptor.kind).toBe(
        descriptor.kindVersion,
      );
      expect(adapter?.supportedFormats, descriptor.kind).toEqual(
        descriptor.formats,
      );
      const emptySelection = adapter?.selectionSchema.safeParse({});
      if (emptySelection?.success) {
        expect(
          reportSelectionSchema.safeParse(emptySelection.data).success,
        ).toBe(true);
      }
      expect(
        adapter?.selectionSchema.safeParse(null).success,
        descriptor.kind,
      ).toBe(false);
    }
  });
});
