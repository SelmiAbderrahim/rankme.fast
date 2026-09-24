import { vi, describe, expect, it } from "vitest";
import type * as FileSystem from "node:fs";
import { readReportPdfFont } from "./pdf-support.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  const bundledFont = new URL(
    "../../modules/audits/pdf/fonts/NotoSans-Regular.ttf",
    import.meta.url,
  );
  return {
    ...actual,
    existsSync: () => false,
    readFileSync: () => actual.readFileSync(bundledFont),
  };
});

describe("report PDF packaged-font fallback", () => {
  it("loads the build-layout font path when source-layout assets are absent", () => {
    expect(
      readReportPdfFont("NotoSans-Regular.ttf").byteLength,
    ).toBeGreaterThan(1_000);
  });
});
