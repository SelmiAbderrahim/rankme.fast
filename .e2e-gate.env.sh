# CI-parity environment for the isolated `rankme-e2e` compose project.
# Mirrors `.github/workflows/ci.yml` → "Boot compose stack (fake providers)",
# with loopback ports shifted off the shared box's occupied 48080-48083 /
# 43000-43003 range. Source this before `make build-up` / `make ps` /
# `npx playwright test` so the canonical gate never touches the operator's
# production-flavoured root `.env` stack.
export COMPOSE_PROJECT_NAME=rankme-e2e
export API_PORT=48091
export WEB_PORT=43011
export CLIENT_URL=http://127.0.0.1:43011
export APP_URL="$CLIENT_URL"
export SERVER_URL=http://127.0.0.1:48091
export VITE_API_BASE_URL=/api
export VITE_SITE_URL=http://127.0.0.1:43011
export VITE_GA_ID=
export API_INTERNAL_URL=http://api:8080
export POSTGRES_USER=rankme
export POSTGRES_PASSWORD=e2e
export POSTGRES_DB=rankme
export DATABASE_URL=postgres://rankme:e2e@postgres:5432/rankme
export MONGODB_URI=mongodb://mongo:27017/rankme
export REDIS_URL=redis://redis:6379
export BETTER_AUTH_SECRET=e2e-better-auth-secret-e2e-better-auth-secret
export MASTER_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
# Never inherit the operator's production-flavoured Resend credentials from
# root `.env`: Better Auth awaits verification delivery during signup, which
# would make the deterministic composed gate perform live network I/O.
export RESEND_API_KEY=
export RESEND_FROM=
# Optional contact/bootstrap inputs must also be cleared so this isolated gate
# cannot inherit invalid or production-flavoured values from the host shell.
export CONTACT_FORM_RECIPIENT=e2e-contact@example.com
export SUPERADMIN_EMAIL=e2e-admin@example.com
export SUPERADMIN_PASSWORD=e2e-admin-password
export EMAIL_TRANSPORT=resend
export E2E_EMAIL_CAPTURE=false
# The composed browser gate intentionally runs deterministic providers under a
# production Node runtime. This explicit seam is the only reason that posture
# is accepted; every live credential remains blank below.
export ALLOW_FAKE_PROVIDERS=true
# The local operator `.env` may contain live credentials. Compose gives
# exported shell values precedence over that file, so the deterministic gate
# must explicitly shadow every outbound-vendor secret instead of relying only
# on fake provider selectors. Empty values are intentional and are asserted in
# the release proof from the resolved Compose model (never from this prose).
export DATAFORSEO_LOGIN=
export DATAFORSEO_PASSWORD=
export GOOGLE_API_KEY=
export GOOGLE_CLIENT_ID=
export GOOGLE_CLIENT_SECRET=
export GOOGLE_GENERATIVE_AI_API_KEY=
export ANTHROPIC_API_KEY=
export OPENAI_API_KEY=
export DEEPSEEK_API_KEY=
export GLM_API_KEY=
export KIMI_API_KEY=
export STRIPE_SECRET_KEY=
export SENDGRID_API_KEY=
export MAILCHIMP_API_KEY=
export ALERT_WEBHOOK_URL=
export PROVIDER_AUDIT=fake
export PROVIDER_RANK=fake
export PROVIDER_KEYWORD=fake
export PROVIDER_BACKLINK=fake
export PROVIDER_COMPETITOR=fake
export PROVIDER_PAGESPEED=fake
export PROVIDER_GSC=fake
export PROVIDER_GA4=fake
export PROVIDER_SUMMARY=fake
export PROVIDER_LOCAL_LISTINGS=fake
export PROVIDER_AI_VISIBILITY=fake
export PROVIDER_CONTENT_SOURCE=fake
export PROVIDER_CONTENT_ANALYSIS=fake
export PROVIDER_REVIEWS=fake
export PROVIDER_TRENDS=fake
export PROVIDER_APP_DATA=fake
export PROVIDER_AI=fake
# Provider enablement is independent from the high-level selector. Pin every
# live AI backend off so the gate cannot inherit `*_ENABLED=true` from the
# operator `.env` while its credential is deliberately shadowed above.
export GLM_ENABLED=false
export DEEPSEEK_ENABLED=false
export KIMI_ENABLED=false
export OPENAI_ENABLED=false
export GOOGLE_ENABLED=false
export ANTHROPIC_ENABLED=false
# Exercise the content-monitoring product surface against its deterministic
# fake adapter. Production credential readiness is assessed separately; the
# isolated gate must neither inherit the operator's disabled flag nor require
# a live Firecrawl webhook secret.
export CONTENT_MONITORING_ENABLED=true
export FIRECRAWL_WEBHOOK_SECRET=
export FIRECRAWL_WEBHOOK_SECRETS=
export FIRECRAWL_WEBHOOK_SECRET_BINDINGS=
export FIRECRAWL_API_KEY=
export FIRECRAWL_FALLBACK_API_KEYS=
# Pin every pricing-envelope input. Shell exports override the operator's root
# .env, so the isolated release proof cannot inherit a wider runtime clamp.
export PAGESPEED_SAMPLE_SIZE=3
export SERP_DEPTH=100
export SERP_LIVE_DEPTH=20
export FIRECRAWL_MAX_CRAWL_PAGES=100
export FIRECRAWL_COST_MICROS_PER_CREDIT=1000
export CONTENT_ANALYSIS_COST_CEILING_MICROS=250000
export CONTENT_ANALYSIS_AI_BUDGET_MICROS=140000
export CONTENT_INVENTORY_MAX_PAGES=100
export AI_MAX_ATTEMPTS=6
export WORKER_CONCURRENCY=5
export GLM_INPUT_COST_MICROS_PER_MILLION=
export GLM_OUTPUT_COST_MICROS_PER_MILLION=
export DEEPSEEK_INPUT_COST_MICROS_PER_MILLION=
export DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION=
export KIMI_INPUT_COST_MICROS_PER_MILLION=
export KIMI_OUTPUT_COST_MICROS_PER_MILLION=
export OPENAI_INPUT_COST_MICROS_PER_MILLION=
export OPENAI_OUTPUT_COST_MICROS_PER_MILLION=
export GOOGLE_INPUT_COST_MICROS_PER_MILLION=
export GOOGLE_OUTPUT_COST_MICROS_PER_MILLION=
export ANTHROPIC_INPUT_COST_MICROS_PER_MILLION=
export ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION=
export LINK_INTELLIGENCE_ENABLED=true
export TRAFFIC_INSIGHTS_ENABLED=true
export KEYWORD_TRENDS_ENABLED=true
export REVIEW_INTELLIGENCE_ENABLED=true
export BRAND_RADAR_ENABLED=true
# rankme-community-requests kill switches (prompt 00). Declared here in the
# SAME change that adds them to the zod schema so no later prompt's journey
# silently boots its surface dark. A flag is inert until its owning prompt
# lands; once it lands, `true` is what that prompt's journey needs.
#   SERP_FEATURE_TRACKING_ENABLED — LIVE (prompt 01): gates new durable
#   `serp_observations` capture only. Stored owner reads remain available when
#   disabled. `serp-features.spec.ts` proves the kill switch and restores it.
export SERP_FEATURE_TRACKING_ENABLED=true
export KEYWORD_CLUSTERING_ENABLED=true
export ALT_ENGINE_TRACKING_ENABLED=true
export CANNIBALIZATION_ENABLED=true
export TOXIC_LINKS_ENABLED=true
export ALERTS_ENABLED=true
# Alert detection sweep runs every 5s under the gate so the journey observes a
# dispatch without waiting out the 5-minute production cadence.
export ALERT_SWEEP_INTERVAL_MS=5000
export INTERNAL_LINKING_ENABLED=true
export CONTENT_BRIEFS_ENABLED=true
export GEOGRID_ENABLED=true
export SCHEMA_GENERATOR_ENABLED=true
export CLIENT_REPORTS_ENABLED=true
export PUBLIC_EXPORTS_ENABLED=true
# Per-run direct-cost ceilings, micros USD — pinned at the shipped defaults so
# the gate boots with the same envelope the margin math assumes.
export CONTENT_BRIEF_COST_CEILING_MICROS=120000
export INTERNAL_LINKING_COST_CEILING_MICROS=12000
export TOXICITY_COST_CEILING_MICROS=30000
export SCHEMA_GEN_COST_CEILING_MICROS=6000
# AI Assistant (rankme-ai-chat-mcp 01). CHAT_ENABLED defaults true; pinned
# here so the gate boots the surface deliberately, matching the other flags.
# The chat journeys stream against the fake AI provider (PROVIDER_AI=fake).
export CHAT_ENABLED=true
export AI_CHAT_MAX_OUTPUT_TOKENS=2048
export AI_CHAT_TOTAL_TIMEOUT_MS=120000
export AI_CHAT_MAX_STEPS=5
# rankme-app-seo (prompt 00). All six flags on under the gate so every ASO
# surface a later prompt lands is exercised by its journey instead of booting
# dark. APP_SEO_ENABLED is the master switch; the other five sit under it.
export APP_SEO_ENABLED=true
export APP_KEYWORD_TRACKING_ENABLED=true
export APP_LISTING_AUDITS_ENABLED=true
export APP_CHART_TRACKING_ENABLED=true
export APP_RESEARCH_ENABLED=true
export APP_REVIEWS_ENABLED=true
# App-review AI ceiling + ASO named rate buckets — pinned at the shipped
# defaults so the gate boots with the same envelope the margin math assumes.
export APP_REVIEW_AI_COST_CEILING_MICROS=40000
export RATE_LIMIT_APP_SEO_CREATE_WINDOW_MS=60000
export RATE_LIMIT_APP_SEO_CREATE_MAX=10
export RATE_LIMIT_APP_SEO_POLL_WINDOW_MS=60000
export RATE_LIMIT_APP_SEO_POLL_MAX=60
export RATE_LIMIT_AUTH_WINDOW_MS=60000
export PLAYWRIGHT_BASE_URL=http://127.0.0.1:43011
export PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:48091
