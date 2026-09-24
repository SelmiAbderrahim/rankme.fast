import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { localizedUrl, DEFAULT_LOCALE } from "./seo.data.js";
import { env } from "../../config/env.js";

const app = createApp();
const originalReleaseStage = env.VITE_RELEASE_STAGE;
const originalRepositoryUrl = env.GITHUB_REPOSITORY_URL;

afterEach(() => {
  env.VITE_RELEASE_STAGE = originalReleaseStage;
  env.GITHUB_REPOSITORY_URL = originalRepositoryUrl;
});

describe("seo.data.localizedUrl", () => {
  it("serves the root path un-prefixed for the default locale", () => {
    expect(localizedUrl("https://x.io/", DEFAULT_LOCALE, "/")).toBe(
      "https://x.io/",
    );
  });

  it("appends a non-root path for the default locale", () => {
    expect(localizedUrl("https://x.io", DEFAULT_LOCALE, "/faq")).toBe(
      "https://x.io/faq",
    );
  });

  it("prefixes non-default locales with the locale segment", () => {
    expect(localizedUrl("https://x.io", "ar", "/faq")).toBe(
      "https://x.io/ar/faq",
    );
  });
});

describe("seo module", () => {
  it("serves robots.txt as text/plain with crawler allows and disallows", async () => {
    const res = await request(app).get("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("GPTBot");
    expect(res.text).toContain("PerplexityBot");
    expect(res.text).toContain("ClaudeBot");
    expect(res.text).toContain("Disallow: /dashboard");
    expect(res.text).toMatch(/^Sitemap: .+\/sitemap\.xml$/m);
  });

  it("serves the sitemap index referencing the child sitemaps", async () => {
    const res = await request(app).get("/sitemap.xml");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/xml/);
    expect(res.text).toContain("<sitemapindex");
    expect(res.text).toContain("/sitemap-docs.xml");
    for (const removed of [
      "/sitemap-core.xml",
      "/sitemap-alternatives.xml",
      "/sitemap-audit-guides.xml",
      "/sitemap-guides.xml",
    ]) {
      expect(res.text).not.toContain(removed);
    }
  });

  it("never exposes private client-portal token paths in any sitemap", async () => {
    for (const path of ["/sitemap.xml", "/sitemap-docs.xml"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("/portal/");
      expect(res.text).not.toContain("/client-portal/");
    }
  });

  it("serves every localized documentation route in its own sitemap", async () => {
    const res = await request(app).get("/sitemap-docs.xml");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<loc>http");
    expect(res.text).toContain("/docs/getting-started");
    expect(res.text).toContain("/docs/rankmefast-mcp");
    expect(res.text).toContain("/docs/ai-assistant");
    expect(res.text).not.toContain("/docs/ci-gates");
    expect(res.text).toContain("/ar/docs/ai-summary");
    expect(res.text).toContain('hreflang="x-default"');
  });

  it("includes the newer docs slugs with localized hreflang alternates", async () => {
    const res = await request(app).get("/sitemap-docs.xml");
    expect(res.status).toBe(200);
    for (const slug of [
      "confirmed-rank-alerts",
      "next-actions",
      "ai-visibility-citations",
      "audience-research",
      "keyword-intelligence",
    ]) {
      expect(res.text).toContain(`/docs/${slug}`);
      expect(res.text).toContain(`/ar/docs/${slug}`);
      expect(res.text).toMatch(
        new RegExp(`hreflang="ar"[^>]*/ar/docs/${slug}`),
      );
    }
  });

  it("no longer serves the removed marketing sitemaps", async () => {
    for (const path of [
      "/sitemap-core.xml",
      "/sitemap-alternatives.xml",
      "/sitemap-audit-guides.xml",
      "/sitemap-guides.xml",
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    }
  });

  it("serves /llms.txt as text/plain with the curated URL list", async () => {
    const res = await request(app).get("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("# rankme.fast");
    expect(res.text).toContain("/docs");
    expect(res.text).toContain("/docs/getting-started");
    expect(res.text).toContain("/docs/self-hosting");
    for (const marketing of ["/free-audit", "/serp-sensor", "/guides", "/keyword-intelligence"]) {
      expect(res.text).not.toContain(marketing);
    }
    expect(res.text).toMatch(/^Sitemap: .+\/sitemap\.xml$/m);
  });

  it("adds beta status and the public repository to llms.txt only when configured", async () => {
    env.VITE_RELEASE_STAGE = "beta";
    env.GITHUB_REPOSITORY_URL = "https://github.com/rankmefast/rankmefast";
    const beta = await request(app).get("/llms.txt");
    expect(beta.text).toContain("Status: public beta");
    expect(beta.text).toContain(
      "Repository: https://github.com/rankmefast/rankmefast",
    );

    env.VITE_RELEASE_STAGE = "ga";
    env.GITHUB_REPOSITORY_URL = undefined;
    const ga = await request(app).get("/llms.txt");
    expect(ga.text).not.toContain("Status: public beta");
    expect(ga.text).not.toContain("Repository:");
  });

  it("sitemap urlsets escape XML-unsafe characters via localizedUrl", () => {
    expect(localizedUrl("https://x.io", "ar", "/faq")).toBe(
      "https://x.io/ar/faq",
    );
  });
});
