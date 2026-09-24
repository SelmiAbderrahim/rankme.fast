import mongoose from "mongoose";
import { createHash } from "node:crypto";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import {
  teamMembers,
  teamMemberSiteGrants,
} from "../../db/schema/team-members.js";
import {
  REPORT_DOCUMENT_SCHEMA,
  REPORT_DOCUMENT_SCHEMA_VERSION,
  REPORT_FORMAT_EXTENSIONS,
  REPORT_FORMAT_MEDIA_TYPES,
  REPORT_GLOBAL_BOUNDS,
  ReportRenderRefusal,
  getReportCatalogDescriptor,
  reportDocumentV1Schema,
  type ReportDocumentV1,
  type ReportKindId,
  type ReportRenderedResult,
} from "../../shared/report-exports/index.js";
import { SUPPORTED_LOCALES, translate } from "../../shared/i18n/index.js";
import { HttpError } from "../../shared/utils/http-error.js";
import { __setCsrfBypassForTests } from "../../shared/middleware/csrf.js";
import { WORKSPACE_HEADER } from "../../shared/middleware/workspace-context.js";
import {
  installTestAuth,
  signupTestUser,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from "../../shared/testing/auth.js";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "../../shared/testing/mongo.js";
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from "../../shared/testing/postgres.js";
import { Site } from "../sites/index.js";
import { setTeamDb } from "../team/index.js";
import { User } from "../users/index.js";
import { AuditLog } from "../audit/index.js";
import {
  createReportExportAdapterRegistry,
  reportExportRegistryTestables,
  ReportExportAdapterRegistry,
} from "./report-exports.registry.js";
import { createReportExportRetentionProcessor } from "./report-export-retention.js";
import { ReportExportSnapshot } from "./report-export-snapshot.model.js";
import { ReportExportShare } from "./report-export-share.model.js";
import { reportExportControllerTestables } from "./report-exports.controller.js";
import { reportExportShareControllerTestables } from "./report-export-shares.controller.js";
import {
  REPORT_SHARE_ACCOUNT_ACTIVE_MAX,
  REPORT_SHARE_SNAPSHOT_ACTIVE_MAX,
  authenticatePublicReportShareToken,
  createReportExportShare,
  listReportExportSharesForAccount,
  reportExportShareServiceTestables,
  resolvePublicReportShare,
  revokeReportExportShare,
} from "./report-export-shares.service.js";
import {
  setReportExportAdapterRegistry,
  setReportExportsDb,
  getReportExportsDb,
} from "./report-exports.holder.js";
import {
  cleanupReportExports,
  createReportExport,
  deleteReportExport,
  denyReportExportsForAccount,
  denyReportExportsForSite,
  downloadPublicReportExport,
  downloadReportExport,
  inspectPublicReportExport,
  inspectReportExport,
  listReportExports,
  reportExportRefusalCode,
  reportExportServiceTestables,
  resolveOwnedReportExportSiteId,
  stableReportJson,
} from "./report-exports.service.js";
import type {
  ReportExportAccessContext,
  ReportExportAdapter,
  ReportExportComposeContext,
  ReportExportRenderContext,
} from "./report-exports.types.js";

const app = createApp();
const ORIGINAL_EXPORTS_FLAG = env.PUBLIC_EXPORTS_ENABLED;
let emailSequence = 0;

const routeSelectionSchema = z
  .object({
    title: z.string().max(100_000).default("Stored audit"),
    items: z.number().int().min(0).max(20_000).default(2),
  })
  .strict();
type RouteSelection = z.infer<typeof routeSelectionSchema>;

interface StoredSource {
  accountId: string;
  siteId: string;
  version: string;
  deleted: boolean;
}

class RouteTestAdapter implements ReportExportAdapter<RouteSelection> {
  readonly kind = "audit.run" as const;
  readonly kindVersion = 1;
  readonly supportedFormats = ["pdf", "csv", "json"] as const;
  readonly selectionSchema = routeSelectionSchema;
  readonly sources = new Map<string, StoredSource>();
  readonly lockedAccounts = new Set<string>();
  composeState:
    | "complete"
    | "incomplete"
    | "invalid_text"
    | "canonical_too_large"
    | "wrong_kind"
    | "wrong_version"
    | "wrong_locale"
    | "wrong_branding"
    | "invalid_result" = "complete";
  renderState: "valid" | "invalid_metadata" | "too_large" | "wrong_format" =
    "valid";
  mutateVersionDuringCompose = false;
  disableFlagOnPersist = false;
  acceptAnyTarget = false;
  expireDuringRender = false;
  revokeSharesDuringAccess = false;
  readonly accessPurposes: string[] = [];
  composeCalls = 0;
  renderCalls = 0;
  readonly spendCounters = { provider: 0, queue: 0, usage: 0 };

  register(accountId: string, siteId: string, resourceId: string): void {
    this.sources.set(resourceId, {
      accountId,
      siteId,
      version: `version-${resourceId}`,
      deleted: false,
    });
  }

  async assertAccess(context: ReportExportAccessContext): Promise<void> {
    this.accessPurposes.push(context.purpose);
    if (
      this.revokeSharesDuringAccess &&
      (context.purpose === "read" || context.purpose === "download")
    ) {
      await ReportExportShare.updateMany(
        { revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }
    if (context.purpose === "persist" && this.disableFlagOnPersist) {
      env.PUBLIC_EXPORTS_ENABLED = false;
    }
    if (this.acceptAnyTarget) return;
    if (context.target.scope !== "site_resource") {
      throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    }
    const source = this.sources.get(context.target.resourceId);
    if (
      !source ||
      source.deleted ||
      source.accountId !== context.accountId ||
      source.siteId !== context.target.siteId
    ) {
      throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    }
    if (this.lockedAccounts.has(context.accountId)) {
      throw HttpError.forbidden({ code: 'ERRORS_FORBIDDEN', messageKey: "errors.forbidden" });
    }
    if (
      context.purpose === "persist" &&
      context.sourceVersion &&
      context.sourceVersion !== source.version
    ) {
      throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: "reportExports.errors.sourceChanged" });
    }
  }

  async compose(
    context: Omit<ReportExportComposeContext, "selection"> & {
      selection: RouteSelection;
    },
  ) {
    this.composeCalls += 1;
    if (this.composeState === "invalid_result") return null as never;
    const target = context.target;
    if (target.scope !== "site_resource") {
      throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    }
    const source = this.sources.get(target.resourceId);
    if (!source) throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const representedItems =
      this.composeState === "incomplete"
        ? Math.max(0, context.selection.items - 1)
        : context.selection.items;
    const title =
      this.composeState === "invalid_text"
        ? `Unsafe\u202etitle`
        : context.selection.title;
    const rows = Array.from(
      { length: Math.min(context.selection.items, 250) },
      (_, index) => ({
        id: `row-${index + 1}`,
        cells: [
          {
            columnKey: "finding",
            value: {
              type: "string" as const,
              value: index === 0 ? title : `Stored finding ${index + 1}`,
            },
            sourceDateId: "observed",
          },
        ],
      }),
    );
    const document: ReportDocumentV1 = {
      schema: REPORT_DOCUMENT_SCHEMA,
      schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
      kind: "audit.run",
      kindVersion: 1,
      locale: context.locale,
      title,
      subject: [{ label: "Report", value: "Stored audit result" }],
      selection: [{ label: "Items", value: String(context.selection.items) }],
      sourceDates: [
        {
          id: "observed",
          label: "Audit observation",
          kind: "provider_observation",
          observedAt: "2026-08-08T12:00:00.000Z",
          sourceNoteKey: "source.audit",
        },
      ],
      completeness: {
        state: "complete",
        selectedItems: context.selection.items,
        representedItems,
        bound: "Every selected stored finding",
      },
      branding: context.branding,
      blocks: [
        {
          type: "table",
          id: "findings",
          columns: [{ key: "finding", label: "Finding", valueType: "string" }],
          rows,
        },
      ],
      artifacts: [],
    };
    if (this.composeState === "canonical_too_large") {
      document.blocks = Array.from({ length: 105 }, (_, index) => ({
        type: "prose" as const,
        id: `large-${index + 1}`,
        tone: "body" as const,
        text: "x".repeat(100_000),
      }));
    }
    if (this.composeState === "wrong_kind") document.kind = "ranks.current";
    if (this.composeState === "wrong_version") document.kindVersion = 2;
    if (this.composeState === "wrong_locale") document.locale = "fr";
    if (this.composeState === "wrong_branding") {
      document.branding = { ...document.branding, accentColor: "#000000" };
    }
    const sourceVersion = source.version;
    if (this.mutateVersionDuringCompose)
      source.version = `${source.version}-new`;
    return { document, sourceVersion };
  }

  async render(context: ReportExportRenderContext) {
    this.renderCalls += 1;
    if (this.expireDuringRender) {
      await ReportExportSnapshot.collection.updateMany(
        {},
        { $set: { expiresAt: new Date(0) } },
      );
    }
    if (this.renderState === "too_large") {
      return {
        format: context.format,
        mediaType: REPORT_FORMAT_MEDIA_TYPES[context.format],
        extension: REPORT_FORMAT_EXTENSIONS[context.format],
        bytes: Buffer.alloc(25 * 1024 * 1024 + 1),
      };
    }
    const renderedFormat =
      this.renderState === "wrong_format" ? "csv" : context.format;
    const mediaType =
      this.renderState === "invalid_metadata"
        ? "text/html"
        : REPORT_FORMAT_MEDIA_TYPES[renderedFormat];
    const payload =
      context.format === "json"
        ? stableReportJson(context.document)
        : context.format === "csv"
          ? `\uFEFFtitle\r\n"${context.document.title.replaceAll('"', '""')}"\r\n`
          : `%PDF-test\n${context.snapshotCreatedAt}\n${context.document.title}\n`;
    return {
      format: renderedFormat,
      mediaType,
      extension: REPORT_FORMAT_EXTENSIONS[renderedFormat],
      bytes: Buffer.from(payload, "utf8"),
    };
  }
}

class NativeRouteTestAdapter implements ReportExportAdapter<RouteSelection> {
  readonly kind = "backlinks.disavow" as const;
  readonly kindVersion = 1;
  readonly supportedFormats = ["txt"] as const;
  readonly selectionSchema = routeSelectionSchema;
  renderState: RouteTestAdapter["renderState"] = "valid";
  expireDuringRender = false;
  renderCalls = 0;

  constructor(private readonly accessAdapter: RouteTestAdapter) {}

  async assertAccess(context: ReportExportAccessContext): Promise<void> {
    await this.accessAdapter.assertAccess(context);
  }

  async compose(
    context: Omit<ReportExportComposeContext, "selection"> & {
      selection: RouteSelection;
    },
  ) {
    if (context.target.scope !== "site_resource") {
      throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    }
    const source = this.accessAdapter.sources.get(context.target.resourceId);
    if (!source) throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: "audits.errors.notFound" });
    const bytes = Buffer.from("domain:example.test\n", "utf8");
    return {
      sourceVersion: source.version,
      document: {
        schema: REPORT_DOCUMENT_SCHEMA,
        schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
        kind: this.kind,
        kindVersion: this.kindVersion,
        locale: context.locale,
        title: context.selection.title,
        subject: [{ label: "Site", value: "Stored backlink source" }],
        selection: [{ label: "Items", value: "1" }],
        sourceDates: [
          {
            id: "observed",
            label: "Backlink observation",
            kind: "provider_observation" as const,
            observedAt: "2026-08-08T12:00:00.000Z",
            sourceNoteKey: "source.backlinks",
          },
        ],
        completeness: {
          state: "complete" as const,
          selectedItems: 1,
          representedItems: 1,
          bound: "One stored disavow artifact",
        },
        branding: context.branding,
        blocks: [
          {
            type: "native_artifact" as const,
            id: "disavow-block",
            artifactId: "disavow",
          },
        ],
        artifacts: [
          {
            id: "disavow",
            label: "Disavow file",
            format: "txt" as const,
            mediaType: "text/plain; charset=utf-8" as const,
            extension: "txt" as const,
            byteLength: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            validation: "valid" as const,
          },
        ],
      },
    };
  }

  async render(
    context: ReportExportRenderContext,
  ): Promise<ReportRenderedResult> {
    this.renderCalls += 1;
    if (this.expireDuringRender) {
      await ReportExportSnapshot.collection.updateMany(
        {},
        { $set: { expiresAt: new Date(0) } },
      );
    }
    if (this.renderState === "too_large") {
      return {
        format: "txt",
        mediaType: REPORT_FORMAT_MEDIA_TYPES.txt,
        extension: REPORT_FORMAT_EXTENSIONS.txt,
        bytes: Buffer.alloc(25 * 1024 * 1024 + 1),
      };
    }
    if (this.renderState === "wrong_format") {
      return {
        format: "md",
        mediaType: REPORT_FORMAT_MEDIA_TYPES.md,
        extension: REPORT_FORMAT_EXTENSIONS.md,
        bytes: Buffer.from("domain:example.test\n", "utf8"),
      };
    }
    return {
      format: context.format,
      mediaType:
        this.renderState === "invalid_metadata"
          ? "text/html"
          : REPORT_FORMAT_MEDIA_TYPES.txt,
      extension: REPORT_FORMAT_EXTENSIONS.txt,
      bytes: Buffer.from("domain:example.test\n", "utf8"),
    };
  }
}

let adapter: RouteTestAdapter;

function installNativeRouteTestAdapter(): NativeRouteTestAdapter {
  const native = new NativeRouteTestAdapter(adapter);
  const registry = new ReportExportAdapterRegistry();
  registry.register(native);
  setReportExportAdapterRegistry(registry);
  return native;
}

interface Context {
  user: TestUser;
  siteId: string;
  resourceId: string;
}

async function context(verified = true): Promise<Context> {
  emailSequence += 1;
  const user = verified
    ? await signupVerifiedUser(app, {
        email: `report-export-${emailSequence}@example.test`,
      })
    : await signupTestUser(app, {
        email: `report-export-${emailSequence}@example.test`,
      });
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    url: `https://report-${emailSequence}.example`,
    domain: `report-${emailSequence}.example`,
    displayName: "Stored report source",
  });
  const resourceId = `audit-${emailSequence}`;
  adapter.register(user.id, String(site._id), resourceId);
  return { user, siteId: String(site._id), resourceId };
}

function body(
  source: Pick<Context, "siteId" | "resourceId">,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "audit.run",
    format: "json",
    target: {
      scope: "site_resource",
      siteId: source.siteId,
      resourceId: source.resourceId,
    },
    selection: { title: "Stored audit", items: 2 },
    ...overrides,
  };
}

function testPngBase64(): string {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type: string, data = Buffer.alloc(0)): Buffer => {
    const value = Buffer.alloc(12 + data.length);
    value.writeUInt32BE(data.length, 0);
    value.write(type, 4, 4, "ascii");
    data.copy(value, 8);
    return value;
  };
  return Buffer.concat([
    signature,
    chunk("IHDR", Buffer.alloc(13)),
    chunk("IDAT"),
    chunk("IEND"),
  ]).toString("base64");
}

function genericCatalogAdapter(kind: ReportKindId): ReportExportAdapter {
  const descriptor = getReportCatalogDescriptor(kind)!;
  return {
    kind,
    kindVersion: descriptor.kindVersion,
    supportedFormats: descriptor.formats,
    selectionSchema: z.object({}).strict(),
    async assertAccess() {},
    async compose(context) {
      return {
        sourceVersion: `stored-${kind}`,
        document: {
          schema: REPORT_DOCUMENT_SCHEMA,
          schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
          kind,
          kindVersion: descriptor.kindVersion,
          locale: context.locale,
          title: `Stored ${kind}`,
          subject: [{ label: "Report", value: "Stored source" }],
          selection: [],
          sourceDates: [
            {
              id: "range",
              label: "Stored range",
              kind: "first_party_observation" as const,
              from: "2026-08-01T00:00:00.000Z",
              to: "2026-08-08T00:00:00.000Z",
              sourceNoteKey: "source.range",
            },
          ],
          completeness: {
            state: "complete" as const,
            selectedItems: 0,
            representedItems: 0,
            bound: "Complete stored scope",
          },
          branding: context.branding,
          blocks: [
            {
              type: "table" as const,
              id: "rows",
              columns: [
                { key: "value", label: "Value", valueType: "string" as const },
              ],
              rows: [],
            },
          ],
          artifacts: [],
        },
      };
    },
    async render(context) {
      return {
        format: context.format,
        mediaType: REPORT_FORMAT_MEDIA_TYPES[context.format],
        extension: REPORT_FORMAT_EXTENSIONS[context.format],
        bytes: Buffer.from(stableReportJson(context.document), "utf8"),
      };
    },
  };
}

function createSnapshot(
  source: Context,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post("/api/report-exports")
    .set("Cookie", source.user.cookie)
    .send(body(source, overrides));
}

async function replaceStoredDocument(
  snapshotId: string,
  document: ReportDocumentV1,
): Promise<void> {
  const canonicalJson = stableReportJson(document);
  await ReportExportSnapshot.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(snapshotId) },
    {
      $set: {
        canonicalJson,
        canonicalBytes: Buffer.byteLength(canonicalJson, "utf8"),
        contentHash: createHash("sha256").update(canonicalJson).digest("hex"),
        representedItems: document.completeness.representedItems,
      },
    },
  );
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setReportExportsDb(db);
  setTeamDb(db);
});

afterAll(async () => {
  env.PUBLIC_EXPORTS_ENABLED = ORIGINAL_EXPORTS_FLAG;
  setReportExportAdapterRegistry(null);
  setReportExportsDb(null);
  setTeamDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  env.PUBLIC_EXPORTS_ENABLED = true;
  adapter = new RouteTestAdapter();
  const registry = new ReportExportAdapterRegistry();
  registry.register(adapter);
  setReportExportAdapterRegistry(registry);
  __setCsrfBypassForTests(true);
});

describe("report-export authenticated management routes", () => {
  it("lists localized capabilities and the empty account share center", async () => {
    const source = await context();
    const capabilities = await request(app)
      .get("/api/report-exports/capabilities")
      .set("Cookie", source.user.cookie)
      .set("Accept-Language", "fr")
      .expect(200);
    expect(capabilities.body).toMatchObject({
      enabled: true,
      kinds: [
        {
          kind: "audit.run",
          title: translate("fr", "reportExports.catalog.auditRun.title"),
          titleKey: "reportExports.catalog.auditRun.title",
          descriptionKey: "reportExports.catalog.auditRun.description",
          boundKey: "reportExports.catalog.auditRun.bound",
        },
      ],
    });
    expect(capabilities.headers["content-language"]).toBe("fr");
    await request(app)
      .get("/api/report-exports/shares")
      .set("Cookie", source.user.cookie)
      .expect(200, { items: [], nextCursor: null });
  });

  it("requires authentication and verified email on all five operations", async () => {
    const snapshotId = new mongoose.Types.ObjectId().toString();
    await request(app).post("/api/report-exports").send({}).expect(401);
    await request(app).get("/api/report-exports").expect(401);
    await request(app).get(`/api/report-exports/${snapshotId}`).expect(401);
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .expect(401);
    await request(app).delete(`/api/report-exports/${snapshotId}`).expect(401);

    const unverified = await context(false);
    await request(app)
      .post("/api/report-exports")
      .set("Cookie", unverified.user.cookie)
      .send(body(unverified))
      .expect(403);
    await request(app)
      .get("/api/report-exports")
      .set("Cookie", unverified.user.cookie)
      .expect(403);
  });

  it("creates, inspects, lists, downloads, and idempotently deletes one snapshot", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    expect(created.body.snapshot).toMatchObject({
      id: snapshotId,
      kind: "audit.run",
      format: "json",
      locale: "en",
      title: "Stored audit",
      completeness: { selectedItems: 2, representedItems: 2 },
    });

    const inspected = await request(app)
      .get(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(200);
    expect(inspected.body.snapshot.document.title).toBe("Stored audit");

    const listed = await request(app)
      .get("/api/report-exports?limit=1&kind=audit.run&format=json")
      .set("Cookie", source.user.cookie)
      .expect(200);
    expect(listed.body).toMatchObject({
      items: [{ id: snapshotId }],
      nextCursor: null,
    });

    await User.findByIdAndUpdate(source.user.id, { language: "de" });
    const downloaded = await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .set("Accept-Language", "ar")
      .expect(200)
      .expect("Cache-Control", "private, no-store")
      .expect("Content-Language", "en")
      .expect("X-Content-Type-Options", "nosniff");
    expect(downloaded.headers["content-disposition"]).toMatch(
      /^attachment; filename="rankmefast-audit-2026-08-08\.json";/u,
    );
    expect(downloaded.body).toMatchObject({ title: "Stored audit" });

    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(204);
    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(204);
    await request(app)
      .get(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(404);
  });

  it("uses zod boundaries, catalog format truth, and constant cross-account 404s", async () => {
    const source = await context();
    await createSnapshot(source, {
      target: { scope: "site_resource", siteId: "bad", resourceId: "audit" },
    }).expect(400);
    await createSnapshot(source, {
      target: { scope: "site", siteId: source.siteId },
    }).expect(404);
    await createSnapshot(source, { format: "md" }).expect(400);

    const created = await createSnapshot(source).expect(201);
    const stranger = await context();
    const snapshotId = created.body.snapshot.id as string;
    await request(app)
      .get(`/api/report-exports/${snapshotId}`)
      .set("Cookie", stranger.user.cookie)
      .expect(404);
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", stranger.user.cookie)
      .expect(404);
    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", stranger.user.cookie)
      .expect(404);
    const list = await request(app)
      .get("/api/report-exports")
      .set("Cookie", stranger.user.cookie)
      .expect(200);
    expect(list.body.items).toEqual([]);
  });

  it("resolves stored report Sites for selected-scope teammates and hides account-wide reports", async () => {
    const owner = await context();
    const member = await context();
    const siteSnapshot = await createSnapshot(owner).expect(201);
    const registry = new ReportExportAdapterRegistry();
    registry.register(adapter);
    registry.register(genericCatalogAdapter("keyword.research_result"));
    setReportExportAdapterRegistry(registry);
    const accountSnapshot = await createReportExport({
      accountId: owner.user.id,
      actorUserId: owner.user.id,
      kind: "keyword.research_result",
      format: "json",
      target: {
        scope: "account_resource",
        resourceId: "selected-scope-research",
      },
      selection: {},
      requestLocale: "en",
      brandingMode: "rankmefast",
    });
    await request(app)
      .post("/api/report-exports")
      .set("Cookie", owner.user.cookie)
      .send({
        kind: "keyword.research_result",
        format: "json",
        target: {
          scope: "account_resource",
          resourceId: "owner-account-research",
        },
        selection: {},
      })
      .expect(201);
    const [membership] = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.user.id,
        userId: member.user.id,
        email: member.user.email,
        role: "member",
        siteAccessMode: "selected",
        inviteTokenHash: "d".repeat(64),
        invitedBy: owner.user.id,
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: teamMembers.id });
    if (!membership) throw new Error("expected membership");
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: membership.id,
      siteId: owner.siteId,
    });

    await expect(
      resolveOwnedReportExportSiteId(
        owner.user.id,
        siteSnapshot.body.snapshot.id as string,
      ),
    ).resolves.toBe(owner.siteId);
    await expect(
      inspectReportExport({
        accountId: owner.user.id,
        actorUserId: member.user.id,
        snapshotId: siteSnapshot.body.snapshot.id as string,
      }),
    ).resolves.toMatchObject({ id: siteSnapshot.body.snapshot.id });
    const selectedSiteRead = await request(app)
      .get(`/api/report-exports/${siteSnapshot.body.snapshot.id as string}`)
      .set("Cookie", member.user.cookie)
      .set(WORKSPACE_HEADER, owner.user.id);
    expect(
      selectedSiteRead.status,
      JSON.stringify(selectedSiteRead.body),
    ).toBe(200);
    await request(app)
      .get(`/api/report-exports/${accountSnapshot.id}`)
      .set("Cookie", member.user.cookie)
      .set(WORKSPACE_HEADER, owner.user.id)
      .expect(404);
    await request(app)
      .get(`/api/report-exports/${new mongoose.Types.ObjectId()}`)
      .set("Cookie", member.user.cookie)
      .set(WORKSPACE_HEADER, owner.user.id)
      .expect(404);
    await request(app)
      .post("/api/report-exports")
      .set("Cookie", member.user.cookie)
      .set(WORKSPACE_HEADER, owner.user.id)
      .send({
        kind: "keyword.research_result",
        format: "json",
        target: {
          scope: "account_resource",
          resourceId: "selected-scope-denied",
        },
        selection: {},
      })
      .expect(404);
  });

  it("enforces the existing CSRF convention on mutations but exempts safe reads", async () => {
    const source = await context();
    __setCsrfBypassForTests(false);
    try {
      await createSnapshot(source).expect(403);
      await request(app)
        .delete(`/api/report-exports/${new mongoose.Types.ObjectId()}`)
        .set("Cookie", source.user.cookie)
        .expect(403);
      await request(app)
        .get("/api/report-exports")
        .set("Cookie", source.user.cookie)
        .expect(200);
    } finally {
      __setCsrfBypassForTests(true);
    }
  });
});

describe("report-export snapshot persistence allowlist", () => {
  it("stores one immutable canonical projection and only bounded ownership metadata", async () => {
    const source = await context();
    const hostileTitle = '<script>alert("x")</script> =2+3 🧭';
    const first = await createSnapshot(source, {
      selection: { title: hostileTitle, items: 2 },
    }).expect(201);
    const second = await createSnapshot(source, {
      selection: { title: hostileTitle, items: 2 },
    }).expect(201);
    expect(second.body.snapshot.id).toBe(first.body.snapshot.id);
    expect(await ReportExportSnapshot.countDocuments()).toBe(1);

    const stored = await ReportExportSnapshot.findById(
      first.body.snapshot.id,
    ).lean();
    expect(stored).not.toBeNull();
    expect(Object.keys(stored as object).sort()).toEqual([
      "__v",
      "_id",
      "accountId",
      "canonicalBytes",
      "canonicalJson",
      "contentHash",
      "createdAt",
      "createdByUserId",
      "deletedAt",
      "downloadCount",
      "expiresAt",
      "format",
      "kind",
      "kindVersion",
      "lastDownloadedAt",
      "locale",
      "purgeAt",
      "representedItems",
      "schemaVersion",
      "siteId",
      "sourceResourceId",
      "sourceVersion",
      "targetScope",
    ]);
    const record = stored as NonNullable<typeof stored>;
    const canonical = JSON.parse(record.canonicalJson) as Record<
      string,
      unknown
    >;
    expect(Object.keys(canonical).sort()).toEqual([
      "artifacts",
      "blocks",
      "branding",
      "completeness",
      "kind",
      "kindVersion",
      "locale",
      "schema",
      "schemaVersion",
      "selection",
      "sourceDates",
      "subject",
      "title",
    ]);
    expect(canonical.title).toBe(hostileTitle);
    expect(record.canonicalBytes).toBe(
      Buffer.byteLength(record.canonicalJson, "utf8"),
    );
    expect(record.contentHash).toBe(
      createHash("sha256").update(record.canonicalJson).digest("hex"),
    );
    expect(record.schemaVersion).toBe(1);
    expect(record.kindVersion).toBe(1);
    expect(record.representedItems).toBe(2);
    expect(record.downloadCount).toBe(0);
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(
      90 * 24 * 60 * 60 * 1_000,
    );

    const serialized = JSON.stringify(canonical);
    for (const forbidden of [
      source.user.id,
      source.siteId,
      source.resourceId,
      "authorization",
      "cookie",
      "billing",
      "rawVendorPayload",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await ReportExportSnapshot.updateOne(
      { _id: record._id },
      {
        $set: {
          canonicalJson: '{"mutated":true}',
          kind: "ranks.current",
          sourceVersion: "mutated",
        },
      },
    );
    const immutable = await ReportExportSnapshot.findById(record._id).lean();
    expect(immutable?.canonicalJson).toBe(record.canonicalJson);
    expect(immutable?.kind).toBe("audit.run");
    expect(immutable?.sourceVersion).toBe(record.sourceVersion);
  });

  it("rejects unknown persistence fields and over-bound selection payloads", async () => {
    const source = await context();
    await expect(
      ReportExportSnapshot.create({
        accountId: source.user.id,
        siteId: source.siteId,
        createdByUserId: source.user.id,
        targetScope: "site_resource",
        sourceResourceId: source.resourceId,
        sourceVersion: "version",
        kind: "audit.run",
        format: "json",
        locale: "en",
        schemaVersion: 1,
        kindVersion: 1,
        canonicalJson: "{}",
        canonicalBytes: 2,
        contentHash: "a".repeat(64),
        representedItems: 0,
        expiresAt: new Date(Date.now() + 1_000),
        rawVendorPayload: { secret: "must-not-persist" },
      }),
    ).rejects.toThrow(/strict/u);

    await createSnapshot(source, {
      selection: { title: "x".repeat(65 * 1024), items: 2 },
    }).expect(400);
    expect(await ReportExportSnapshot.countDocuments()).toBe(0);
  });
});

describe("report-export denial-first lifecycle", () => {
  it("treats an expired snapshot as absent before physical cleanup", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    const expiredAt = new Date(Date.now() - 1_000);
    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(snapshotId) },
      { $set: { expiresAt: expiredAt } },
    );

    await request(app)
      .get(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(404);
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(404);
    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(404);
    expect(await ReportExportSnapshot.countDocuments()).toBe(1);
    expect(await cleanupReportExports(new Date())).toBe(1);
    expect(await cleanupReportExports(new Date())).toBe(0);
  });

  it("denies and purges a snapshot immediately when its source disappears", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    const storedSource = adapter.sources.get(source.resourceId);
    expect(storedSource).toBeDefined();
    if (storedSource) storedSource.deleted = true;

    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(404);
    const denied = await ReportExportSnapshot.findById(snapshotId).lean();
    expect(denied?.deletedAt).toBeInstanceOf(Date);
    expect(denied?.purgeAt).toBeInstanceOf(Date);
    expect(await cleanupReportExports(new Date(Date.now() + 1_000))).toBe(1);
    expect(await cleanupReportExports(new Date(Date.now() + 1_000))).toBe(0);
  });

  it("makes site/account denial idempotent and keeps manual deletion purge-bounded", async () => {
    const siteSource = await context();
    const siteSnapshot = await createSnapshot(siteSource).expect(201);
    // Keep purgeAt ahead of the wall clock until this test explicitly drains
    // it; otherwise Mongo's TTL monitor can delete one row during a slow run.
    const deniedAt = new Date(Date.now() + 60 * 60 * 1_000);
    expect(await denyReportExportsForSite(siteSource.siteId, deniedAt)).toBe(1);
    expect(await denyReportExportsForSite(siteSource.siteId, deniedAt)).toBe(0);
    await request(app)
      .get(`/api/report-exports/${siteSnapshot.body.snapshot.id as string}`)
      .set("Cookie", siteSource.user.cookie)
      .expect(404);

    const accountSource = await context();
    const accountSnapshot = await createSnapshot(accountSource).expect(201);
    expect(
      await denyReportExportsForAccount(accountSource.user.id, deniedAt),
    ).toBe(1);
    expect(
      await denyReportExportsForAccount(accountSource.user.id, deniedAt),
    ).toBe(0);
    await request(app)
      .get(`/api/report-exports/${accountSnapshot.body.snapshot.id as string}`)
      .set("Cookie", accountSource.user.cookie)
      .expect(404);

    expect(await cleanupReportExports(deniedAt)).toBe(2);
    expect(await cleanupReportExports(deniedAt)).toBe(0);

    const manualSource = await context();
    const manual = await createSnapshot(manualSource).expect(201);
    await request(app)
      .delete(`/api/report-exports/${manual.body.snapshot.id as string}`)
      .set("Cookie", manualSource.user.cookie)
      .expect(204);
    expect(await cleanupReportExports(new Date())).toBe(0);
    expect(
      await cleanupReportExports(new Date(Date.now() + 25 * 60 * 60 * 1_000)),
    ).toBe(1);
    expect(
      await cleanupReportExports(new Date(Date.now() + 25 * 60 * 60 * 1_000)),
    ).toBe(0);
  });

  it("declares TTL indexes for expiry and denied-record purge", () => {
    const ttlIndexes = ReportExportSnapshot.schema
      .indexes()
      .filter(([, options]) => options.expireAfterSeconds === 0);
    expect(ttlIndexes).toHaveLength(2);
    expect(ttlIndexes.map(([fields]) => fields)).toEqual([
      { expiresAt: 1 },
      { purgeAt: 1 },
    ]);
  });
});

describe("report-export localization and safe audit trail", () => {
  it("ships every report-export error in all seven locales", () => {
    const keys = [
      "unavailable",
      "notFound",
      "adapterUnavailable",
      "formatUnsupported",
      "invalidBranding",
      "invalidSelection",
      "incomplete",
      "invalidDocument",
      "scopeTooLarge",
      "sourceChanged",
      "corrupted",
      "invalidRenderedResult",
      "invalidText",
      "invalidUrl",
      "invalidSourceDate",
      "invalidArtifact",
      "duplicateId",
      "invalidTable",
      "invalidSourceReference",
      "selectionTooLarge",
      "selectionTooComplex",
      "outputTooLarge",
      "rateLimited",
    ];
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        const path = `reportExports.errors.${key}`;
        expect(translate(locale, path)).not.toBe(path);
      }
    }
  });

  it("records created/downloaded/deleted/refused events without report payloads", async () => {
    const source = await context();
    const hostileTitle = "<script>private-report-copy</script> =cmd";
    const created = await createSnapshot(source, {
      selection: { title: hostileTitle, items: 2 },
    }).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(200);
    const refused = await createSnapshot(source, { format: "md" })
      .set("Accept-Language", "fr")
      .expect(400);
    expect(refused.body.error.message).toBe(
      translate("fr", "reportExports.errors.formatUnsupported"),
    );
    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(204);

    const entries = await AuditLog.find({ actorUserId: source.user.id })
      .sort({ createdAt: 1 })
      .lean();
    expect(entries.map((entry) => entry.action)).toEqual([
      "report_export.created",
      "report_export.rendered",
      "report_export.downloaded",
      "report_export.refused",
      "report_export.deleted",
    ]);
    expect(entries.map((entry) => entry.targetType)).toEqual([
      "report_export",
      "report_export",
      "report_export",
      "report_export",
      "report_export",
    ]);
    expect(entries.map((entry) => entry.metadata)).toEqual([
      { kind: "audit.run", format: "json", status: "created" },
      { kind: "audit.run", format: "json", status: "rendered" },
      { kind: "audit.run", format: "json", status: "downloaded" },
      { kind: "audit.run", format: "md", status: "refused" },
      { kind: "audit.run", format: "json", status: "deleted" },
    ]);
    const auditJson = JSON.stringify(entries);
    for (const forbidden of [
      hostileTitle,
      source.resourceId,
      source.siteId,
      "private-report-copy",
      "shareToken",
      "canonicalJson",
      "contentHash",
      "authorization",
      "cookie",
    ]) {
      expect(auditJson).not.toContain(forbidden);
    }
  });
});

describe("report-export invariant matrix", () => {
  it("refuses incomplete, invalid, over-kind, over-format, and source-raced composition without persistence", async () => {
    const source = await context();

    adapter.composeState = "incomplete";
    const incomplete = await createSnapshot(source).expect(422);
    expect(incomplete.body.error.message).toBe(
      translate("en", "reportExports.errors.incomplete"),
    );

    adapter.composeState = "invalid_text";
    await createSnapshot(source).expect(422);

    adapter.composeState = "canonical_too_large";
    await createSnapshot(source).expect(422);

    adapter.composeState = "complete";
    await createSnapshot(source, {
      selection: { title: "Too many JSON rows", items: 10_001 },
    }).expect(422);
    await createSnapshot(source, {
      format: "pdf",
      selection: {
        title: "Too many PDF rows",
        items: REPORT_GLOBAL_BOUNDS.pdfItems + 1,
      },
    }).expect(422);

    adapter.mutateVersionDuringCompose = true;
    await createSnapshot(source).expect(409);
    expect(await ReportExportSnapshot.countDocuments()).toBe(0);
  });

  it("rejects unsafe rendered metadata and output bytes above the hard ceiling", async () => {
    const source = await context();
    const native = installNativeRouteTestAdapter();
    const created = await createSnapshot(source, {
      kind: "backlinks.disavow",
      format: "txt",
    }).expect(201);
    const snapshotId = created.body.snapshot.id as string;

    native.renderState = "invalid_metadata";
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(422);
    native.renderState = "too_large";
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(422);
    native.renderState = "wrong_format";
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(422);

    const snapshot = await ReportExportSnapshot.findById(snapshotId).lean();
    expect(snapshot?.downloadCount).toBe(0);
    expect(native.renderCalls).toBe(3);
  });

  it("keeps hostile HTML, spreadsheet prefixes, and emoji inert while rejecting broken Unicode", async () => {
    const source = await context();
    const hostileTitle =
      '  =HYPERLINK("https://evil.test") <script>x</script> 🧪';
    const created = await createSnapshot(source, {
      selection: { title: hostileTitle, items: 2 },
    }).expect(201);
    const downloaded = await request(app)
      .get(`/api/report-exports/${created.body.snapshot.id as string}/download`)
      .set("Cookie", source.user.cookie)
      .expect(200)
      .expect("Content-Type", /application\/json/u);
    expect(downloaded.body.title).toBe(hostileTitle);
    expect(downloaded.headers["content-disposition"]).not.toContain(
      "evil.test",
    );

    await createSnapshot(source, {
      selection: { title: "broken\ud800", items: 2 },
    }).expect(400);
  });

  it("performs no spend and keeps rollback operations available while creation is disabled", async () => {
    const source = await context();
    env.PUBLIC_EXPORTS_ENABLED = false;
    await createSnapshot(source).expect(503);
    expect(adapter.accessPurposes).toEqual([]);
    expect(adapter.composeCalls).toBe(0);

    env.PUBLIC_EXPORTS_ENABLED = true;
    const created = await createSnapshot(source).expect(201);
    expect(adapter.accessPurposes).toEqual(["create", "persist"]);
    expect(adapter.composeCalls).toBe(1);
    const snapshotId = created.body.snapshot.id as string;

    env.PUBLIC_EXPORTS_ENABLED = false;
    await request(app)
      .get(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(200);
    await request(app)
      .get("/api/report-exports")
      .set("Cookie", source.user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(200);
    await request(app)
      .delete(`/api/report-exports/${snapshotId}`)
      .set("Cookie", source.user.cookie)
      .expect(204);
    expect(adapter.spendCounters).toEqual({ provider: 0, queue: 0, usage: 0 });
  });

  it("does not advertise a catalog kind when the production registry has no adapter", async () => {
    const source = await context();
    setReportExportAdapterRegistry(new ReportExportAdapterRegistry());
    await createSnapshot(source).expect(503);
    expect(await ReportExportSnapshot.countDocuments()).toBe(0);
  });

  it("inherits source access on create/download but tolerates later source mutation", async () => {
    const locked = await context();
    adapter.lockedAccounts.add(locked.user.id);
    await createSnapshot(locked).expect(403);
    expect(await ReportExportSnapshot.countDocuments()).toBe(0);

    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    adapter.lockedAccounts.add(source.user.id);
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(403);
    adapter.lockedAccounts.delete(source.user.id);
    const storedSource = adapter.sources.get(source.resourceId);
    if (storedSource) storedSource.version = "later-source-version";
    await request(app)
      .get(`/api/report-exports/${snapshotId}/download`)
      .set("Cookie", source.user.cookie)
      .expect(200);
  });

  it("freezes valid white-label branding", async () => {
    const source = await context();
    const logoPngBase64 = testPngBase64();
    await User.updateOne(
      { _id: source.user.id },
      {
        $set: {
          branding: {
            companyName: "  Acme Search  ",
            accentColor: "#A1B2C3",
            logoPngBase64,
            logoWidth: 24,
            logoHeight: 12,
          },
        },
      },
    );
    const created = await createSnapshot(source, {
      brandingMode: "white_label",
    }).expect(201);
    expect(created.body.snapshot.document.branding).toMatchObject({
      mode: "white_label",
      companyName: "Acme Search",
      accentColor: "#a1b2c3",
      logo: {
        mediaType: "image/png",
        bytesBase64: logoPngBase64,
        width: 24,
        height: 12,
        sha256: createHash("sha256")
          .update(Buffer.from(logoPngBase64, "base64"))
          .digest("hex"),
      },
    });

    await request(app)
      .get(`/api/report-exports/${created.body.snapshot.id as string}/download`)
      .set("Cookie", source.user.cookie)
      .expect(200);

    const missing = await context();
    await createSnapshot(missing, { brandingMode: "white_label" }).expect(400);
  });

  it("validates locales, paginates deterministically, and withholds integrity failures", async () => {
    const source = await context();
    await createSnapshot(source, { locale: "it" }).expect(400);
    const first = await createSnapshot(source, {
      locale: "fr",
      selection: { title: "Premier rapport", items: 2 },
    }).expect(201);
    const second = await createSnapshot(source, {
      locale: "fr",
      selection: { title: "Deuxième rapport", items: 2 },
    }).expect(201);
    expect(first.body.snapshot.document.locale).toBe("fr");

    const pageOne = await request(app)
      .get("/api/report-exports?limit=1")
      .set("Cookie", source.user.cookie)
      .expect(200);
    expect(pageOne.body.items).toHaveLength(1);
    expect(pageOne.body.nextCursor).toEqual(expect.any(String));
    const pageTwo = await request(app)
      .get(
        `/api/report-exports?limit=1&cursor=${pageOne.body.nextCursor as string}`,
      )
      .set("Cookie", source.user.cookie)
      .expect(200);
    expect(pageTwo.body.items).toHaveLength(1);
    expect(pageTwo.body.items[0].id).not.toBe(pageOne.body.items[0].id);

    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(second.body.snapshot.id as string) },
      { $set: { contentHash: "0".repeat(64) } },
    );
    await request(app)
      .get(`/api/report-exports/${second.body.snapshot.id as string}`)
      .set("Cookie", source.user.cookie)
      .expect(500);
  });
});

describe("report-export service defensive contracts", () => {
  it("classifies only allowlisted refusal reasons and fails closed without its DB holder", () => {
    expect(reportExportRefusalCode(new Error("plain"))).toBeNull();
    expect(
      reportExportRefusalCode(
        new HttpError(400, { code: 'X', messageKey: "errors.badRequest" }, { code: "unsupported_format" }),
      ),
    ).toBe("unsupported_format");
    expect(reportExportRefusalCode(new HttpError(404, { code: 'X', messageKey: "errors.notFound" }))).toBe(
      "target_not_found",
    );
    expect(reportExportRefusalCode(new HttpError(409, { code: 'X', messageKey: "errors.conflict" }))).toBe(
      "source_changed",
    );
    expect(reportExportRefusalCode(new HttpError(500, { code: 'X', messageKey: "errors.internal" }))).toBeNull();
    expect(
      reportExportRefusalCode(new HttpError(500, { code: 'X', messageKey: "errors.internal" }, { code: 123 })),
    ).toBeNull();

    const db = getReportExportsDb();
    setReportExportsDb(null);
    expect(() => getReportExportsDb()).toThrow(/not configured/u);
    setReportExportsDb(db);
  });

  it("maps renderer refusals and rejects unsafe public identifiers and network targets", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const document = reportDocumentV1Schema.parse(created.body.snapshot.document);
    const noTable = reportDocumentV1Schema.parse({
      ...document,
      blocks: [
        {
          type: "prose",
          id: "summary",
          tone: "body",
          text: "Stored report summary",
        },
      ],
    });

    for (const [reason, expectedCode] of [
      ["scope_too_large", "scope_too_large"],
      ["invalid_output", "invalid_output"],
    ] as const) {
      try {
        reportExportServiceTestables.throwRenderabilityFailure(
          new ReportRenderRefusal(reason, "refused"),
          document,
        );
      } catch (error) {
        expect(reportExportRefusalCode(error)).toBe(expectedCode);
      }
    }
    const original = new Error("original render failure");
    expect(() =>
      reportExportServiceTestables.throwRenderabilityFailure(original, document),
    ).toThrow(original);
    expect(() =>
      reportExportServiceTestables.assertFormatRenderable(noTable, "csv"),
    ).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() =>
      reportExportServiceTestables.assertFormatRenderable(document, "txt"),
    ).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() =>
      reportExportServiceTestables.throwDownloadRenderFailure(
        new ReportRenderRefusal("scope_too_large", "refused"),
      ),
    ).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() =>
      reportExportServiceTestables.throwDownloadRenderFailure(
        new ReportRenderRefusal("invalid_output", "refused"),
      ),
    ).toThrowError(expect.objectContaining({ status: 422 }));

    for (const hostname of [
      "LOCALHOST",
      "api",
      "mongo",
      "postgres",
      "redis",
      "service.local",
      "[::1]",
      "10.0.0.1",
      "127.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
    ]) {
      expect(reportExportServiceTestables.internalPublicHostname(hostname)).toBe(
        true,
      );
    }
    for (const hostname of [
      "example.com",
      "192.0.2.1",
      "172.15.0.1",
      "172.32.0.1",
      "192.167.0.1",
      "1.2.3",
      "1.2.nope.4",
    ]) {
      expect(reportExportServiceTestables.internalPublicHostname(hostname)).toBe(
        false,
      );
    }
    for (const value of [
      "507f1f77bcf86cd799439011",
      "550e8400-e29b-41d4-a716-446655440000",
      "owner@example.test",
      "http://localhost/private",
      "https://api/private",
      [false, "owner@example.test"],
      { nested: "http://10.0.0.1/private" },
    ]) {
      expect(reportExportServiceTestables.unsafePublicValue(value)).toBe(true);
    }
    for (const value of [
      null,
      false,
      "Stored report",
      "https://example.test/report",
      "ftp://localhost/private",
      ["Stored report"],
      { nested: "Stored report" },
    ]) {
      expect(reportExportServiceTestables.unsafePublicValue(value)).toBe(false);
    }

    expect(
      reportExportServiceTestables.isPublicFormatAllowed("unknown", "view"),
    ).toBe(false);
    expect(
      reportExportServiceTestables.isPublicFormatAllowed(
        "backlinks.disavow",
        "view",
      ),
    ).toBe(false);
    expect(
      reportExportServiceTestables.isPublicFormatAllowed("audit.run", "csv"),
    ).toBe(false);
    expect(
      reportExportServiceTestables.isPublicFormatAllowed("audit.run", "pdf"),
    ).toBe(true);
    expect(
      reportExportServiceTestables.isPublicSnapshotWithinBounds(
        document,
        REPORT_GLOBAL_BOUNDS.canonicalBytes,
      ),
    ).toBe(true);
    expect(
      reportExportServiceTestables.isPublicSnapshotWithinBounds(
        {
          ...document,
          completeness: {
            ...document.completeness,
            representedItems: REPORT_GLOBAL_BOUNDS.pdfItems + 1,
          },
        },
        1,
      ),
    ).toBe(false);
    expect(
      reportExportServiceTestables.isPublicSnapshotWithinBounds(
        document,
        REPORT_GLOBAL_BOUNDS.canonicalBytes + 1,
      ),
    ).toBe(false);

    await expect(
      reportExportServiceTestables.nativeRenderer(
        adapter,
        document,
        "json",
        "2026-08-08T12:00:00.000Z",
      )(),
    ).resolves.toMatchObject({ format: "json" });
  });

  it("covers controller, share-policy, lease, registry, and retention invariants", async () => {
    expect(() =>
      reportExportControllerTestables.assertAccountScopedReportAccess(
        "selected",
      ),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      reportExportControllerTestables.assertAccountScopedReportAccess("all"),
    ).not.toThrow();
    expect(
      reportExportControllerTestables.canManageAllReports("member"),
    ).toBe(false);
    for (const role of ["owner", "admin", undefined] as const) {
      expect(reportExportControllerTestables.canManageAllReports(role)).toBe(
        true,
      );
    }

    const token = "a".repeat(43);
    expect(
      reportExportShareControllerTestables.publicViewParams({ token }),
    ).toEqual({ token });
    expect(
      reportExportShareControllerTestables.publicFileParams({
        token,
        format: "pdf",
      }),
    ).toEqual({ token, format: "pdf" });
    expect(() =>
      reportExportShareControllerTestables.publicViewParams({ token: "bad" }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      reportExportShareControllerTestables.publicFileParams({
        token,
        format: "json",
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(
      reportExportShareControllerTestables.refusalFormats(new Error("x"), [
        "view",
      ]),
    ).toEqual([]);
    expect(
      reportExportShareControllerTestables.refusalFormats(
        HttpError.notFound({ code: 'X', messageKey: "errors.notFound" }),
        ["view", "pdf"],
      ),
    ).toEqual(["view", "pdf"]);
    expect(
      reportExportShareControllerTestables.requiredShareId(
        new mongoose.Types.ObjectId().toString(),
      ),
    ).toEqual(expect.any(String));
    expect(() =>
      reportExportShareControllerTestables.requiredShareId(undefined),
    ).toThrow(/shareId is required/u);
    expect(
      reportExportShareControllerTestables.requiredPublicFile({ present: true }),
    ).toEqual({ present: true });
    expect(() =>
      reportExportShareControllerTestables.requiredPublicFile(undefined),
    ).toThrow(/public report file is missing/u);
    const observedFailure = new Error("public failure");
    await expect(
      reportExportShareControllerTestables.observedPublicOperation(
        "unknown",
        async () => Promise.reject(observedFailure),
      ),
    ).rejects.toBe(observedFailure);
    await expect(
      reportExportShareControllerTestables.observedPublicOperation(
        "view",
        async () => "ok",
      ),
    ).resolves.toBe("ok");

    expect(
      reportExportShareServiceTestables.requirePublicShareDescriptor("audit.run")
        .kind,
    ).toBe("audit.run");
    for (const kind of ["unknown", "backlinks.disavow"]) {
      expect(() =>
        reportExportShareServiceTestables.requirePublicShareDescriptor(kind),
      ).toThrowError(expect.objectContaining({ status: 404 }));
    }
    const now = new Date("2026-08-08T00:00:00.000Z");
    const requested = new Date("2026-08-10T00:00:00.000Z");
    const snapshot = new Date("2026-08-11T00:00:00.000Z");
    expect(
      reportExportShareServiceTestables.boundedShareExpiry(
        requested,
        snapshot,
        now,
      ),
    ).toBe(requested);
    expect(
      reportExportShareServiceTestables.boundedShareExpiry(
        snapshot,
        requested,
        now,
      ),
    ).toBe(requested);
    expect(() =>
      reportExportShareServiceTestables.boundedShareExpiry(now, snapshot, now),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() =>
      reportExportShareServiceTestables.assertShareCapacity(0, 0),
    ).not.toThrow();
    expect(() =>
      reportExportShareServiceTestables.assertShareCapacity(
        REPORT_SHARE_ACCOUNT_ACTIVE_MAX,
        0,
      ),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() =>
      reportExportShareServiceTestables.assertShareCapacity(
        0,
        REPORT_SHARE_SNAPSHOT_ACTIVE_MAX,
      ),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    expect(
      reportExportShareServiceTestables.resolvedPublicShareKind(
        { kind: "report" },
        { kind: "file" },
      ),
    ).toBe("report");
    expect(
      reportExportShareServiceTestables.resolvedPublicShareKind(undefined, {
        kind: "file",
      }),
    ).toBe("file");
    expect(
      reportExportShareServiceTestables.resolvedPublicShareKind(
        undefined,
        undefined,
      ),
    ).toBe("unknown");
    await expect(
      reportExportShareServiceTestables.requirePublicLease(async () => ({
        acquired: true,
        value: "leased",
      })),
    ).resolves.toBe("leased");
    await expect(
      reportExportShareServiceTestables.requirePublicLease(async () => ({
        acquired: false,
      })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reportExportShareServiceTestables.requirePublicLease(async () =>
        Promise.reject(new Error("lease failed")),
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(reportExportRegistryTestables.sameOrderedValues([], [])).toBe(true);
    expect(reportExportRegistryTestables.sameOrderedValues([], ["audit.run"])).toBe(
      false,
    );
    expect(
      reportExportRegistryTestables.sameOrderedValues(
        ["audit.run", "ranks.current"],
        ["ranks.current", "audit.run"],
      ),
    ).toBe(false);
    const emptyRegistry = createReportExportAdapterRegistry();
    expect(() =>
      reportExportRegistryTestables.assertCompleteRegistry(emptyRegistry, []),
    ).not.toThrow();
    expect(() =>
      reportExportRegistryTestables.assertCompleteRegistry(emptyRegistry, [
        "audit.run",
      ]),
    ).toThrow(/incomplete report-export registry: audit.run/u);

    await expect(createReportExportRetentionProcessor()()).resolves.toEqual({
      purgedSnapshots: 0,
    });
  });

  it("round-trips site and account-resource target shapes from canonical snapshots", async () => {
    const source = await context();
    const registry = new ReportExportAdapterRegistry();
    registry.register(genericCatalogAdapter("ranks.current"));
    registry.register(genericCatalogAdapter("keyword.research_result"));
    setReportExportAdapterRegistry(registry);
    const common = {
      accountId: source.user.id,
      actorUserId: source.user.id,
      selection: {},
      locale: "ar" as const,
      requestLocale: "de" as const,
      brandingMode: "rankmefast" as const,
      format: "json" as const,
    };
    const site = await createReportExport({
      ...common,
      kind: "ranks.current",
      format: "csv",
      target: { scope: "site", siteId: source.siteId },
    });
    const account = await createReportExport({
      ...common,
      kind: "keyword.research_result",
      target: { scope: "account_resource", resourceId: "research-a" },
    });
    const accountWithSite = await createReportExport({
      ...common,
      kind: "keyword.research_result",
      target: {
        scope: "account_resource",
        resourceId: "research-a",
        siteId: source.siteId,
      },
    });
    await expect(
      resolveOwnedReportExportSiteId(source.user.id, "invalid"),
    ).resolves.toBeUndefined();
    await expect(
      resolveOwnedReportExportSiteId(
        source.user.id,
        new mongoose.Types.ObjectId().toString(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveOwnedReportExportSiteId(source.user.id, site.id),
    ).resolves.toBe(source.siteId);
    await expect(
      resolveOwnedReportExportSiteId(source.user.id, account.id),
    ).resolves.toBeNull();
    await expect(
      resolveOwnedReportExportSiteId(source.user.id, accountWithSite.id),
    ).resolves.toBe(source.siteId);
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: site.id,
      }),
    ).resolves.toMatchObject({ id: site.id });
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: account.id,
      }),
    ).resolves.toMatchObject({ id: account.id });
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: accountWithSite.id,
      }),
    ).resolves.toMatchObject({ id: accountWithSite.id });
    await User.findByIdAndUpdate(source.user.id, { language: "zh" });
    const file = await downloadReportExport({
      accountId: source.user.id,
      actorUserId: source.user.id,
      snapshotId: site.id,
    });
    expect(file.locale).toBe("ar");
    expect(file.filename).toBe("rankmefast-rankings-2026-08-08.csv");

    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(account.id) },
      { $set: { sourceResourceId: null } },
    );
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: account.id,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("rejects runtime kind drift, metadata-only branding, adapter selection, document drift, and a flag flip", async () => {
    const source = await context();
    const common = {
      accountId: source.user.id,
      actorUserId: source.user.id,
      format: "json" as const,
      target: {
        scope: "site_resource" as const,
        siteId: source.siteId,
        resourceId: source.resourceId,
      },
      selection: {},
      requestLocale: "en" as const,
      brandingMode: "rankmefast" as const,
    };
    await expect(
      createReportExport({
        ...common,
        kind: "runtime.unknown" as "audit.run",
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      createReportExport({
        ...common,
        kind: "backlinks.inventory",
        format: "csv",
        target: { scope: "site", siteId: source.siteId },
        brandingMode: "white_label",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await createSnapshot(source, {
      selection: { unexpected: true },
    }).expect(400);

    for (const state of [
      "invalid_result",
      "wrong_kind",
      "wrong_version",
      "wrong_locale",
      "wrong_branding",
    ] as const) {
      adapter.composeState = state;
      await createSnapshot(source).expect(422);
    }
    adapter.composeState = "complete";
    adapter.disableFlagOnPersist = true;
    await createSnapshot(source).expect(503);
    expect(await ReportExportSnapshot.countDocuments()).toBe(0);
    env.PUBLIC_EXPORTS_ENABLED = true;
  });

  it("omits source-deleted list entries, propagates access loss, and enforces creator deletion", async () => {
    const source = await context();
    const first = await createSnapshot(source).expect(201);
    const secondResourceId = `${source.resourceId}-second`;
    adapter.register(source.user.id, source.siteId, secondResourceId);
    const second = await request(app)
      .post("/api/report-exports")
      .set("Cookie", source.user.cookie)
      .send(
        body(
          { siteId: source.siteId, resourceId: secondResourceId },
          { selection: { title: "Second stored audit", items: 2 } },
        ),
      )
      .expect(201);
    const firstSource = adapter.sources.get(source.resourceId);
    if (firstSource) firstSource.deleted = true;
    const page = await listReportExports({
      accountId: source.user.id,
      actorUserId: source.user.id,
      limit: 25,
    });
    expect(page.items.map((item) => item.id)).toEqual([
      second.body.snapshot.id as string,
    ]);
    await expect(
      listReportExports({
        accountId: source.user.id,
        actorUserId: source.user.id,
        limit: 25,
        allowedSiteIds: null,
      }),
    ).resolves.toMatchObject({ items: [{ id: second.body.snapshot.id }] });
    await expect(
      listReportExports({
        accountId: source.user.id,
        actorUserId: source.user.id,
        limit: 25,
        allowedSiteIds: [source.siteId],
      }),
    ).resolves.toMatchObject({ items: [{ id: second.body.snapshot.id }] });

    adapter.lockedAccounts.add(source.user.id);
    await expect(
      listReportExports({
        accountId: source.user.id,
        actorUserId: source.user.id,
        limit: 25,
      }),
    ).rejects.toMatchObject({ status: 403 });
    adapter.lockedAccounts.delete(source.user.id);

    await expect(
      deleteReportExport({
        accountId: source.user.id,
        actorUserId: new mongoose.Types.ObjectId().toString(),
        snapshotId: second.body.snapshot.id as string,
        canManageAll: false,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: second.body.snapshot.id as string,
        canManageAll: false,
      }),
    ).resolves.toMatchObject({ id: second.body.snapshot.id as string });
    expect(first.body.snapshot.id).toEqual(expect.any(String));
  });

  it("handles a saturated download counter and an expiry race before bytes commit", async () => {
    const source = await context();
    const capped = await createSnapshot(source).expect(201);
    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(capped.body.snapshot.id as string) },
      { $set: { downloadCount: 1_000_000 } },
    );
    await expect(
      downloadReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: capped.body.snapshot.id as string,
      }),
    ).resolves.toMatchObject({ snapshotId: capped.body.snapshot.id as string });
    expect(
      (await ReportExportSnapshot.findById(capped.body.snapshot.id).lean())
        ?.downloadCount,
    ).toBe(1_000_000);

    const native = installNativeRouteTestAdapter();
    const raced = await createSnapshot(source, {
      kind: "backlinks.disavow",
      format: "txt",
      selection: { title: "Expires during render", items: 2 },
    }).expect(201);
    native.expireDuringRender = true;
    await expect(
      downloadReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: raced.body.snapshot.id as string,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("withholds an existing snapshot when its registered adapter disappears", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    setReportExportAdapterRegistry(new ReportExportAdapterRegistry());
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: created.body.snapshot.id as string,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("withholds an existing snapshot after its owning account disappears", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    await User.deleteOne({ _id: source.user.id });
    await expect(
      inspectReportExport({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: created.body.snapshot.id as string,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects missing, malformed, oversized, and dimension-invalid white-label snapshots", async () => {
    const source = await context();
    const createWhiteLabel = () =>
      createSnapshot(source, { brandingMode: "white_label" });

    await createWhiteLabel().expect(400);
    await User.updateOne(
      { _id: source.user.id },
      {
        $set: {
          branding: {
            companyName: "Acme",
            accentColor: "#123456",
            logoPngBase64: "AB==",
            logoWidth: 24,
            logoHeight: 12,
          },
        },
      },
    );
    await createWhiteLabel().expect(400);
    await User.updateOne(
      { _id: source.user.id },
      {
        $set: {
          "branding.logoPngBase64": Buffer.alloc(16).toString("base64"),
        },
      },
    );
    await createWhiteLabel().expect(400);
    await User.updateOne(
      { _id: source.user.id },
      {
        $set: {
          "branding.logoPngBase64": Buffer.alloc(512 * 1024 + 1).toString(
            "base64",
          ),
        },
      },
    );
    await createWhiteLabel().expect(400);
    await User.updateOne(
      { _id: source.user.id },
      {
        $set: {
          "branding.logoPngBase64": testPngBase64(),
          "branding.logoWidth": 513,
        },
      },
    );
    await createWhiteLabel().expect(400);

    await User.deleteOne({ _id: source.user.id });
    await createWhiteLabel().expect(404);
  });
});

describe("report-export public share lifecycle", () => {
  it("fails share creation closed across feature flips, snapshot races, locale paths, and ineligible kinds", async () => {
    const source = await context();
    const first = await createSnapshot(source).expect(201);
    const firstId = first.body.snapshot.id as string;
    env.PUBLIC_EXPORTS_ENABLED = false;
    try {
      await expect(
        authenticatePublicReportShareToken({
          rawToken: "a".repeat(43),
          format: "view",
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        resolvePublicReportShare({
          rawToken: "a".repeat(43),
          format: "view",
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        createReportExportShare({
          accountId: source.user.id,
          actorUserId: source.user.id,
          snapshotId: firstId,
          body: { formats: ["view"], expiresInDays: 7 },
        }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      env.PUBLIC_EXPORTS_ENABLED = true;
    }

    const raced = await createSnapshot(source, {
      selection: { title: "Snapshot reload race", items: 2 },
    }).expect(201);
    const racedId = raced.body.snapshot.id as string;
    await expect(
      createReportExportShare(
        {
          accountId: source.user.id,
          actorUserId: source.user.id,
          snapshotId: racedId,
          body: { formats: ["view"], expiresInDays: 7 },
        },
        {
          afterPublicInspection: async () => {
            await ReportExportSnapshot.collection.deleteOne({
              _id: new mongoose.Types.ObjectId(racedId),
            });
          },
        },
      ),
    ).rejects.toMatchObject({ status: 404 });

    const commitRace = await createSnapshot(source, {
      selection: { title: "Feature flip race", items: 2 },
    }).expect(201);
    try {
      await expect(
        createReportExportShare(
          {
            accountId: source.user.id,
            actorUserId: source.user.id,
            snapshotId: commitRace.body.snapshot.id as string,
            body: { formats: ["view"], expiresInDays: 7 },
          },
          {
            beforeCommit: async () => {
              env.PUBLIC_EXPORTS_ENABLED = false;
            },
          },
        ),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      env.PUBLIC_EXPORTS_ENABLED = true;
    }

    const french = await createSnapshot(source, {
      locale: "fr",
      selection: { title: "Rapport stocké", items: 2 },
    }).expect(201);
    const frenchRecord = await ReportExportSnapshot.findById(
      french.body.snapshot.id,
    ).lean();
    const snapshotExpiry = frenchRecord?.expiresAt;
    expect(snapshotExpiry).toBeInstanceOf(Date);
    if (!snapshotExpiry) throw new Error("expected snapshot expiry");
    const exactStart = new Date(
      snapshotExpiry.getTime() - 90 * 24 * 60 * 60 * 1_000,
    );
    const frenchShare = await createReportExportShare({
      accountId: source.user.id,
      actorUserId: source.user.id,
      snapshotId: french.body.snapshot.id as string,
      body: { formats: ["view"], expiresInDays: 90 },
      now: exactStart,
    });
    expect(frenchShare.url).toContain("/fr/share/");
    expect(frenchShare.expiresAt).toBe(snapshotExpiry.toISOString());

    const native = installNativeRouteTestAdapter();
    expect(native.kind).toBe("backlinks.disavow");
    const ineligible = await createSnapshot(source, {
      kind: "backlinks.disavow",
      format: "txt",
      selection: { title: "Stored native artifact", items: 1 },
    }).expect(201);
    await expect(
      createReportExportShare({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: ineligible.body.snapshot.id as string,
        body: { formats: ["view"], expiresInDays: 7 },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("fails closed for missing, disallowed, inaccessible, unsafe, and over-bound public snapshots", async () => {
    const now = new Date();
    await expect(
      inspectPublicReportExport({
        snapshotId: new mongoose.Types.ObjectId().toString(),
        formats: ["view"],
        shareExpiresAt: new Date(now.getTime() + 60_000),
        now,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    await expect(
      downloadPublicReportExport({ snapshotId, format: "csv", now }),
    ).rejects.toMatchObject({ status: 404 });

    adapter.lockedAccounts.add(source.user.id);
    await expect(
      inspectPublicReportExport({
        snapshotId,
        formats: ["view"],
        shareExpiresAt: new Date(now.getTime() + 60_000),
        now,
      }),
    ).rejects.toMatchObject({ status: 404 });
    adapter.lockedAccounts.delete(source.user.id);

    const unsafe = await createSnapshot(source, {
      selection: { title: "owner@example.test", items: 2 },
    }).expect(201);
    await expect(
      inspectPublicReportExport({
        snapshotId: unsafe.body.snapshot.id as string,
        formats: ["view"],
        shareExpiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ status: 422 });

    const overBound = await createSnapshot(source, {
      selection: { title: "Stored oversized report", items: 2 },
    }).expect(201);
    const overBoundDocument = reportDocumentV1Schema.parse({
      ...overBound.body.snapshot.document,
      completeness: {
        ...overBound.body.snapshot.document.completeness,
        selectedItems: REPORT_GLOBAL_BOUNDS.pdfItems + 1,
        representedItems: REPORT_GLOBAL_BOUNDS.pdfItems + 1,
      },
    });
    await replaceStoredDocument(
      overBound.body.snapshot.id as string,
      overBoundDocument,
    );
    await expect(
      inspectPublicReportExport({
        snapshotId: overBound.body.snapshot.id as string,
        formats: ["view"],
        shareExpiresAt: new Date(now.getTime() + 60_000),
        now,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const wide = await createSnapshot(source, {
      format: "pdf",
      selection: { title: "Stored wide report", items: 2 },
    }).expect(201);
    const originalDocument = reportDocumentV1Schema.parse(
      wide.body.snapshot.document,
    );
    const columns = Array.from({ length: 17 }, (_, index) => ({
      key: `column-${index + 1}`,
      label: `Column ${index + 1}`,
      valueType: "string" as const,
    }));
    const wideDocument = reportDocumentV1Schema.parse({
      ...originalDocument,
      completeness: {
        ...originalDocument.completeness,
        selectedItems: 1,
        representedItems: 1,
      },
      blocks: [
        {
          type: "table",
          id: "wide-table",
          columns,
          rows: [
            {
              id: "wide-row",
              cells: columns.map((column) => ({
                columnKey: column.key,
                value: { type: "string", value: "Stored value" },
                sourceDateId: "observed",
              })),
            },
          ],
        },
      ],
    });
    await replaceStoredDocument(wide.body.snapshot.id as string, wideDocument);
    await expect(
      downloadPublicReportExport({
        snapshotId: wide.body.snapshot.id as string,
        format: "pdf",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("stores only a token hash and serves bounded public view/PDF responses with denial headers", async () => {
    const source = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;
    const shared = await request(app)
      .post(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", source.user.cookie)
      .send({ formats: ["view", "pdf"], expiresInDays: 7 })
      .expect(201);
    const url = new URL(shared.body.share.url as string);
    const token = url.pathname.split("/").at(-1)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(shared.body.share).toMatchObject({
      snapshotId,
      formats: ["view", "pdf"],
      revokedAt: null,
      accessCount: 0,
    });

    const stored = await ReportExportShare.findById(
      shared.body.share.id,
    ).lean();
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(token);
    await expect(
      authenticatePublicReportShareToken({ rawToken: token, format: "view" }),
    ).resolves.toMatchObject({ tokenHash: stored?.tokenHash });

    const view = await request(app)
      .get(`/api/report-shares/${token}`)
      .set("Accept-Language", "ar")
      .expect("Cache-Control", "private, no-store")
      .expect("Content-Language", "en")
      .expect("X-Robots-Tag", "noindex, nofollow, noarchive")
      .expect("Referrer-Policy", "no-referrer")
      .expect("X-Content-Type-Options", "nosniff")
      .expect(200);
    expect(view.body.report).toMatchObject({
      kind: "audit.run",
      formats: ["view", "pdf"],
      title: "Stored audit",
    });
    const publicJson = JSON.stringify(view.body.report);
    expect(publicJson).not.toContain(source.resourceId);
    expect(publicJson).not.toContain(source.siteId);
    expect(publicJson).not.toContain("sourceNoteKey");
    expect(publicJson).not.toContain("sourceDateId");

    const file = await request(app)
      .get(`/api/report-shares/${token}/files/pdf`)
      .set("Accept-Language", "ar")
      .expect("Cache-Control", "private, no-store")
      .expect("Content-Language", "en")
      .expect("Content-Type", "application/pdf")
      .expect("X-Content-Type-Options", "nosniff")
      .expect(200);
    expect(Buffer.from(file.body).subarray(0, 5).toString("ascii")).toBe(
      "%PDF-",
    );
    const accessed = await ReportExportShare.findById(stored?._id).lean();
    expect(accessed?.accessCount).toBe(2);
    expect(accessed?.lastAccessedAt).toBeInstanceOf(Date);

    await request(app)
      .post(
        `/api/report-exports/${snapshotId}/shares/${shared.body.share.id as string}/revoke`,
      )
      .set("Cookie", source.user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/report-shares/${token}`)
      .set("Accept-Language", "de")
      .expect("Cache-Control", "private, no-store")
      .expect("Content-Language", "de")
      .expect("X-Robots-Tag", "noindex, nofollow, noarchive")
      .expect(404);
    await expect(
      authenticatePublicReportShareToken({ rawToken: token, format: "view" }),
    ).rejects.toMatchObject({ status: 404 });
    await request(app).get("/api/report-shares/not-a-token").expect(404);
    await request(app)
      .get(`/api/report-shares/${token}/files/json`)
      .expect(404);
  }, 30_000);

  it("handles saturated and raced share reads, list corruption, and account-scoped public reports", async () => {
    const source = await context();
    const snapshot = await createSnapshot(source).expect(201);
    const firstShare = await createReportExportShare({
      accountId: source.user.id,
      actorUserId: source.user.id,
      snapshotId: snapshot.body.snapshot.id as string,
      body: { formats: ["view"], expiresInDays: 7 },
    });
    const firstToken = new URL(firstShare.url).pathname.split("/").at(-1)!;
    await expect(
      authenticatePublicReportShareToken({
        rawToken: firstToken,
        format: "view",
        now: new Date(),
      }),
    ).resolves.toMatchObject({ tokenHash: expect.any(String) });
    await ReportExportShare.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(firstShare.id) },
      { $set: { accessCount: 1_000_000 } },
    );
    await expect(
      resolvePublicReportShare({ rawToken: firstToken, format: "view" }),
    ).resolves.toMatchObject({
      shareId: firstShare.id,
      kind: "audit.run",
      format: "view",
    });
    expect(
      (await ReportExportShare.findById(firstShare.id).lean())?.accessCount,
    ).toBe(1_000_000);

    const racedShare = await createReportExportShare({
      accountId: source.user.id,
      actorUserId: source.user.id,
      snapshotId: snapshot.body.snapshot.id as string,
      body: { formats: ["view"], expiresInDays: 7 },
    });
    const racedToken = new URL(racedShare.url).pathname.split("/").at(-1)!;
    adapter.revokeSharesDuringAccess = true;
    await expect(
      resolvePublicReportShare({ rawToken: racedToken, format: "view" }),
    ).rejects.toMatchObject({ status: 404 });
    adapter.revokeSharesDuringAccess = false;
    await expect(
      revokeReportExportShare({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId: snapshot.body.snapshot.id as string,
        shareId: racedShare.id,
        now: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ id: racedShare.id });

    await expect(
      listReportExportSharesForAccount({
        accountId: source.user.id,
        actorUserId: source.user.id,
        limit: 10,
        allowedSiteIds: null,
      }),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    const storedSource = adapter.sources.get(source.resourceId);
    if (!storedSource) throw new Error("expected stored report source");
    storedSource.deleted = true;
    const missingSourcePage = await listReportExportSharesForAccount({
      accountId: source.user.id,
      actorUserId: source.user.id,
      limit: 10,
    });
    expect(missingSourcePage.items).not.toHaveLength(0);
    expect(missingSourcePage.items.every((item) => item.snapshot === null)).toBe(
      true,
    );
    storedSource.deleted = false;
    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(snapshot.body.snapshot.id as string) },
      { $set: { deletedAt: null, purgeAt: null } },
    );
    await ReportExportSnapshot.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(snapshot.body.snapshot.id as string) },
      { $set: { contentHash: "0".repeat(64) } },
    );
    await expect(
      listReportExportSharesForAccount({
        accountId: source.user.id,
        actorUserId: source.user.id,
        limit: 10,
      }),
    ).rejects.toMatchObject({ status: 500 });

    const registry = new ReportExportAdapterRegistry();
    registry.register(genericCatalogAdapter("keyword.research_result"));
    setReportExportAdapterRegistry(registry);
    const accountSnapshot = await createReportExport({
      accountId: source.user.id,
      actorUserId: source.user.id,
      kind: "keyword.research_result",
      format: "json",
      target: {
        scope: "account_resource",
        resourceId: "account-research-public",
      },
      selection: {},
      requestLocale: "en",
      brandingMode: "rankmefast",
    });
    const accountShare = await createReportExportShare({
      accountId: source.user.id,
      actorUserId: source.user.id,
      snapshotId: accountSnapshot.id,
      body: { formats: ["view", "csv"], expiresInDays: 7 },
    });
    const accountToken = new URL(accountShare.url).pathname.split("/").at(-1)!;
    await expect(
      resolvePublicReportShare({ rawToken: accountToken, format: "view" }),
    ).resolves.toMatchObject({
      shareId: accountShare.id,
      kind: "keyword.research_result",
    });
    await expect(
      resolvePublicReportShare({ rawToken: accountToken, format: "csv" }),
    ).resolves.toMatchObject({
      shareId: accountShare.id,
      kind: "keyword.research_result",
      file: { format: "csv" },
    });
  }, 30_000);

  it("enforces format allowlists, owner isolation, active-share caps, expiry, and deterministic share-center pagination", async () => {
    const source = await context();
    const foreign = await context();
    const created = await createSnapshot(source).expect(201);
    const snapshotId = created.body.snapshot.id as string;

    await request(app)
      .post(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", foreign.user.cookie)
      .send({ formats: ["view"] })
      .expect(404);
    await request(app)
      .post(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", source.user.cookie)
      .send({ formats: ["view", "csv"] })
      .expect(400);
    await request(app)
      .post(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", source.user.cookie)
      .send({ formats: ["pdf"] })
      .expect(400);

    const shareIds: string[] = [];
    for (let index = 0; index < REPORT_SHARE_SNAPSHOT_ACTIVE_MAX; index += 1) {
      const response = await request(app)
        .post(`/api/report-exports/${snapshotId}/shares`)
        .set("Cookie", source.user.cookie)
        .send({ formats: ["view"], expiresInDays: index + 1 })
        .expect(201);
      shareIds.push(response.body.share.id as string);
    }
    await request(app)
      .post(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", source.user.cookie)
      .send({ formats: ["view"] })
      .expect(409);

    const list = await request(app)
      .get(`/api/report-exports/${snapshotId}/shares`)
      .set("Cookie", source.user.cookie)
      .expect(200);
    expect(list.body.shares).toHaveLength(REPORT_SHARE_SNAPSHOT_ACTIVE_MAX);
    expect(list.body.shares.map((share: { id: string }) => share.id)).toEqual(
      [...shareIds].reverse(),
    );
    const firstPage = await listReportExportSharesForAccount({
      accountId: source.user.id,
      actorUserId: source.user.id,
      limit: 2,
      allowedSiteIds: [source.siteId],
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await listReportExportSharesForAccount({
      accountId: source.user.id,
      actorUserId: source.user.id,
      limit: 10,
      cursor: firstPage.nextCursor!,
      allowedSiteIds: [source.siteId],
    });
    expect(secondPage.items).toHaveLength(3);
    expect(secondPage.nextCursor).toBeNull();
    await expect(
      revokeReportExportShare({
        accountId: source.user.id,
        actorUserId: source.user.id,
        snapshotId,
        shareId: new mongoose.Types.ObjectId().toString(),
      }),
    ).rejects.toMatchObject({ status: 404 });

    const expiring = await createSnapshot(foreign).expect(201);
    const expiringShare = await createReportExportShare({
      accountId: foreign.user.id,
      actorUserId: foreign.user.id,
      snapshotId: expiring.body.snapshot.id as string,
      body: { formats: ["view"], expiresInDays: 1 },
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    const rawToken = new URL(expiringShare.url).pathname.split("/").at(-1)!;
    await expect(
      resolvePublicReportShare({
        rawToken,
        format: "view",
        now: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it("declares immutable share bounds and denial-first TTL indexes", async () => {
    const source = await context();
    const snapshot = await createSnapshot(source).expect(201);
    const invalid = new ReportExportShare({
      accountId: source.user.id,
      snapshotId: snapshot.body.snapshot.id,
      createdByUserId: source.user.id,
      tokenHash: "a".repeat(64),
      formats: ["view", "view"],
      expiresAt: new Date(Date.now() + 1_000),
      purgeAt: new Date(Date.now() + 2_000),
    });
    await expect(invalid.validate()).rejects.toThrow(/unique and non-empty/u);
    const indexes = ReportExportShare.schema.indexes();
    expect(
      indexes.some(
        ([fields, options]) =>
          fields.purgeAt === 1 && options.expireAfterSeconds === 0,
      ),
    ).toBe(true);
    expect(indexes.some(([fields]) => fields.tokenHash === 1)).toBe(true);
  });

  it("audits expired public shares before their purge", async () => {
    const source = await context();
    const snapshot = await createSnapshot(source).expect(201);
    const cleanupAt = new Date(Date.now() + 1_000);
    const share = await ReportExportShare.create({
      accountId: source.user.id,
      siteId: source.siteId,
      snapshotId: snapshot.body.snapshot.id,
      createdByUserId: source.user.id,
      tokenHash: "b".repeat(64),
      formats: ["view"],
      expiresAt: new Date(cleanupAt.getTime() - 2_000),
      purgeAt: new Date(cleanupAt.getTime() - 1_000),
    });
    const revokedShare = await ReportExportShare.create({
      accountId: source.user.id,
      siteId: source.siteId,
      snapshotId: snapshot.body.snapshot.id,
      createdByUserId: source.user.id,
      tokenHash: "c".repeat(64),
      formats: ["view"],
      expiresAt: new Date(cleanupAt.getTime() + 60_000),
      purgeAt: new Date(cleanupAt.getTime() - 1_000),
      revokedAt: new Date(cleanupAt.getTime() - 2_000),
    });

    expect(await cleanupReportExports(cleanupAt)).toBe(0);
    expect(await ReportExportShare.findById(share._id)).toBeNull();
    expect(await ReportExportShare.findById(revokedShare._id)).toBeNull();
    const actions = await AuditLog.find({
      targetType: "report_export_share",
      targetId: String(share._id),
    })
      .sort({ createdAt: 1 })
      .lean();
    expect(actions.map((entry) => entry.action)).toEqual([
      "report_export.expired",
      "report_export.purged",
    ]);
    await expect(
      AuditLog.find({
        targetType: "report_export_share",
        targetId: String(revokedShare._id),
      })
        .distinct("action"),
    ).resolves.toEqual(["report_export.purged"]);
  });
});
