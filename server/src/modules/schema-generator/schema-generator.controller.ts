/**
 * Schema generator controllers. Thin: parse, delegate, respond.
 *
 * The download handler is the ONLY other place in `server/src` allowed to name
 * `application/ld+json`; it streams the STORED payload verbatim and never
 * rebuilds or concatenates JSON-LD (the grep test in
 * `shared/security/json-ld.test.ts` enforces that allow-list).
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { allowedTeamSiteIds } from '../../shared/middleware/team-site-access.js';
import { getSchemaGeneratorAiProviderOrder, getSchemaGeneratorAiRunner, getSchemaGeneratorFetch, } from './schema-generator.holder.js';
import { createGeneration, getGeneration, listGenerations, listSources, previewGeneration, schemaTypesProjection, type SchemaGeneratorDeps, } from './schema-generator.service.js';
import { createGenerationBodySchema, generationIdParamsSchema, listGenerationsQuerySchema, previewGenerationBodySchema, sourcesQuerySchema, } from './schema-generator.schemas.js';
import { JSON_LD_MEDIA_TYPE } from '../../shared/security/json-ld.js';
function serviceDeps(): SchemaGeneratorDeps {
    const fetchUrl = getSchemaGeneratorFetch();
    return {
        ai: getSchemaGeneratorAiRunner(),
        aiProviderOrder: getSchemaGeneratorAiProviderOrder(),
        ...(fetchUrl ? { fetchUrl } : {}),
    };
}
/** GET /api/schema-generator/types — the frozen registry projection. Free. */
export const getTypesController = asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json(schemaTypesProjection());
});
/** GET /api/schema-generator/sources?siteId= — stored page work lists. Free. */
export const getSourcesController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const query = sourcesQuerySchema.parse(req.query);
    res.status(200).json(await listSources({ accountId: accountId, siteId: query.siteId }));
});
/** POST /api/schema-generator/preview — read-only spend disclosure. */
export const previewGenerationController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const body = previewGenerationBodySchema.parse(req.body);
    const preview = await previewGeneration({ accountId: accountId, siteId: body.siteId });
    res.status(200).json(preview);
});
/** POST /api/schema-generator/generations — one bounded generation. */
export const createGenerationController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const body = createGenerationBodySchema.parse(req.body);
    const generation = await createGeneration({
        accountId: accountId,
        siteId: body.siteId,
        source: body.source,
        pageUrl: body.pageUrl,
        schemaType: body.schemaType,
        ...(body.runId ? { runId: body.runId } : {}),
        // `languageMiddleware` always resolves a supported locale, so this is
        // never undefined on the request path.
        outputLocale: req.language,
    }, serviceDeps());
    res.status(201).json(generation);
});
/** GET /api/schema-generator/generations — free stored list, newest first. */
export const listGenerationsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const query = listGenerationsQuerySchema.parse(req.query);
    const page = await listGenerations({
        accountId: accountId,
        limit: query.limit,
        allowedSiteIds: allowedTeamSiteIds(req),
        ...(query.siteId !== undefined ? { siteId: query.siteId } : {}),
    });
    res.status(200).json(page);
});
/** GET /api/schema-generator/generations/:generationId — free re-open. */
export const getGenerationController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = generationIdParamsSchema.parse(req.params);
    const generation = await getGeneration({
        accountId: accountId,
        generationId: params.generationId,
    });
    res.status(200).json(generation);
});
/**
 * GET /api/schema-generator/generations/:generationId/download — the stored
 * payload verbatim as a JSON-LD attachment. A generation that retained no
 * payload has nothing to download, so it is a 404 rather than an empty file.
 */
export const downloadGenerationController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = generationIdParamsSchema.parse(req.params);
    const generation = await getGeneration({
        accountId: accountId,
        generationId: params.generationId,
    });
    if (generation.payload === null) {
        throw HttpError.notFound({ code: 'SCHEMA_GENERATOR_ERRORS_NOT_FOUND', messageKey: 'schemaGenerator.errors.notFound' });
    }
    res.setHeader('Content-Type', JSON_LD_MEDIA_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${generation.schemaType}-${generation.id}.jsonld"`);
    res.status(200).send(generation.payload);
});
