import { Router, type RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { ALLOWED_CRAWLERS, buildUrlEntry, DISALLOWED_PATHS, DOCS_PATHS, LLMS_TXT_PATHS, } from './seo.data.js';
// Build-time constant so sitemap output is deterministic (no Date.now()).
const LASTMOD = '2026-08-10';
/**
 * Canonical public origin for absolute URLs. `CLIENT_URL` is the public web
 * origin (the SPA + public docs) — SEO URLs must point there, not at the API.
 */
function publicOrigin(): string {
    return env.CLIENT_URL.replace(/\/$/, '');
}
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const CHILD_SITEMAPS = ['/sitemap-docs.xml'] as const;
/**
 * Curated LLM discovery file — a plain-text list of canonical URLs for AI
 * crawlers. We recommend it in audits; we ship one ourselves. Keep it small
 * and stable: only pages that meaningfully describe the product.
 */
function renderLlmsTxt(origin: string): string {
    const lines: string[] = [
        '# rankme.fast',
        '',
        '> Plain-language SEO and AI-answer-engine audits — see what to fix so search engines and AI can find, understand, and cite your site.',
        '',
    ];
    if (env.VITE_RELEASE_STAGE === 'beta')
        lines.push('Status: public beta');
    if (env.GITHUB_REPOSITORY_URL)
        lines.push(`Repository: ${env.GITHUB_REPOSITORY_URL}`);
    if (lines.at(-1) !== '')
        lines.push('');
    lines.push('## Pages', '');
    for (const path of LLMS_TXT_PATHS) {
        lines.push(`- ${origin}${path}`);
    }
    lines.push('');
    lines.push(`Sitemap: ${origin}/sitemap.xml`);
    lines.push('');
    return lines.join('\n');
}
function renderRobots(origin: string): string {
    const lines: string[] = [];
    for (const agent of ALLOWED_CRAWLERS) {
        lines.push(`User-agent: ${agent}`);
        lines.push('Allow: /');
        lines.push('');
    }
    lines.push('User-agent: *');
    for (const path of DISALLOWED_PATHS) {
        lines.push(`Disallow: ${path}`);
    }
    lines.push('Allow: /');
    lines.push('');
    lines.push(`Sitemap: ${origin}/sitemap.xml`);
    lines.push('');
    return lines.join('\n');
}
function renderSitemapIndex(origin: string): string {
    const entries = CHILD_SITEMAPS.map((path) => ['  <sitemap>', `    <loc>${origin}${path}</loc>`, `    <lastmod>${LASTMOD}</lastmod>`, '  </sitemap>'].join('\n'));
    return [
        XML_HEADER,
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries,
        '</sitemapindex>',
        '',
    ].join('\n');
}
function renderUrlset(origin: string, paths: readonly string[]): string {
    const entries = paths.map((path) => buildUrlEntry(origin, path, LASTMOD));
    return [
        XML_HEADER,
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...entries,
        '</urlset>',
        '',
    ].join('\n');
}
const robotsHandler: RequestHandler = (_req, res) => {
    res.type('text/plain').send(renderRobots(publicOrigin()));
};
const llmsTxtHandler: RequestHandler = (_req, res) => {
    res.type('text/plain').send(renderLlmsTxt(publicOrigin()));
};
const sitemapIndexHandler: RequestHandler = (_req, res) => {
    res.type('application/xml').send(renderSitemapIndex(publicOrigin()));
};
function urlsetHandler(paths: readonly string[]): RequestHandler {
    return (_req, res) => {
        res.type('application/xml').send(renderUrlset(publicOrigin(), paths));
    };
}
export const seoRouter: Router = Router();
seoRouter.get('/robots.txt', robotsHandler);
seoRouter.get('/llms.txt', llmsTxtHandler);
seoRouter.get('/sitemap.xml', sitemapIndexHandler);
seoRouter.get('/sitemap-docs.xml', urlsetHandler(DOCS_PATHS));
