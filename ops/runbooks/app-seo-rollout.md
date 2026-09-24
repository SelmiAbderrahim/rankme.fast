# App SEO rollout and rollback

This runbook enables the App Store Optimization workspace in increasing order of spend and operational risk. Run every command from the repository root. Keep customer app IDs, keywords, reviews, provider payloads, credentials, and request headers out of rollout notes.

The root `.env` remains the only local environment file. Production values belong in the approved deployment secret store. The commands below expect its wrapper at `DEPLOY_SECRET_SET`; the wrapper must accept a key and value as its two arguments without printing the value.

## 1. Create the five Polar products

Polar keeps sandbox and production separate, including access tokens and organizations. Its product API is `POST /v1/products`, and a fixed price uses integer cents. Create one recurring add-on and four one-time packs in each environment. The products do not need Polar benefits because the verified webhook order is the credit authority in RankMeFast.

Install `curl` and `jq`, then save this helper in the current shell:

```bash
create_polar_product() {
  product_name=$1
  product_amount=$2
  product_interval=$3
  product_key=$4
  payload=$(jq -n \
    --arg name "$product_name" \
    --argjson amount "$product_amount" \
    --arg interval "$product_interval" \
    --arg key "$product_key" \
    --arg organization_id "$POLAR_ORGANIZATION_ID" \
    '{name:$name,description:"RankMeFast App SEO catalog product",visibility:"private",organization_id:$organization_id,metadata:{rankme_key:$key},prices:[{amount_type:"fixed",price_currency:"usd",price_amount:$amount}]} + if $interval == "" then {} else {recurring_interval:$interval,recurring_interval_count:1} end')
  curl --fail-with-body --silent --show-error \
    --request POST "$POLAR_API_BASE/v1/products" \
    --header "Authorization: Bearer $POLAR_OAT" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json' \
    --data "$payload" | jq -er '.id'
}
```

Create the sandbox catalog first. Supply the sandbox organization token and organization ID only in the shell. The command writes product IDs, not credentials, to a mode-600 temporary record:

```bash
export POLAR_API_BASE='https://sandbox-api.polar.sh'
export POLAR_OAT='replace-with-sandbox-organization-token'
export POLAR_ORGANIZATION_ID='replace-with-sandbox-organization-id'
: "${POLAR_OAT:?}" "${POLAR_ORGANIZATION_ID:?}"
product_record=$(mktemp)
chmod 600 "$product_record"
addon_id=$(create_polar_product 'RankMeFast App SEO add-on' 2900 month aso-suite)
keyword_id=$(create_polar_product 'RankMeFast App keyword checks 500' 1900 '' app-keyword-checks-500)
research_id=$(create_polar_product 'RankMeFast App research 50' 1900 '' app-research-50)
competitor_id=$(create_polar_product 'RankMeFast App competitors 20' 1900 '' app-competitors-20)
reviews_id=$(create_polar_product 'RankMeFast App review runs 10' 1900 '' app-review-runs-10)
{
  printf 'POLAR_ADDON_APP_SEO_PRODUCT_ID=%s\n' "$addon_id"
  printf 'POLAR_CREDITS_APP_KEYWORD_CHECKS_PRODUCT_ID=%s\n' "$keyword_id"
  printf 'POLAR_CREDITS_APP_RESEARCH_PRODUCT_ID=%s\n' "$research_id"
  printf 'POLAR_CREDITS_APP_COMPETITORS_PRODUCT_ID=%s\n' "$competitor_id"
  printf 'POLAR_CREDITS_APP_REVIEWS_PRODUCT_ID=%s\n' "$reviews_id"
} > "$product_record"
printf 'Sandbox product ID record: %s\n' "$product_record"
```

Verify the five products in the sandbox organization, including billing interval and price, then run the same block for production with these two changes:

```bash
export POLAR_API_BASE='https://api.polar.sh'
export POLAR_OAT='replace-with-production-organization-token'
export POLAR_ORGANIZATION_ID='replace-with-production-organization-id'
```

Keep sandbox IDs in the sandbox secret store and production IDs in the production secret store. Never mix the records. Polar documents the separate base URLs and tokens in its [sandbox guide](https://polar.sh/docs/integrate/sandbox) and the request contract in [Create Product](https://polar.sh/docs/api-reference/products/create).

## 2. Fill the deployment secret store

Verify the live app-data credentials before selecting the provider. This check reports only whether each value is present:

```bash
: "${DEPLOY_SECRET_GET:?set DEPLOY_SECRET_GET to the approved read wrapper}"
for key in DATAFORSEO_LOGIN DATAFORSEO_PASSWORD; do
  test -n "$("$DEPLOY_SECRET_GET" "$key")" || { printf 'Missing %s\n' "$key" >&2; exit 1; }
done
```

Load the five production IDs from the production record, validate that none is blank, then write them in catalog order. Set the provider selector only after its credentials are present. Keep all six rollout flags false during this step.

```bash
: "${DEPLOY_SECRET_SET:?set DEPLOY_SECRET_SET to the approved write wrapper}"
: "${PRODUCTION_PRODUCT_RECORD:?set PRODUCTION_PRODUCT_RECORD to the production ID record}"
set -a
. "$PRODUCTION_PRODUCT_RECORD"
set +a
for key in \
  POLAR_ADDON_APP_SEO_PRODUCT_ID \
  POLAR_CREDITS_APP_KEYWORD_CHECKS_PRODUCT_ID \
  POLAR_CREDITS_APP_RESEARCH_PRODUCT_ID \
  POLAR_CREDITS_APP_COMPETITORS_PRODUCT_ID \
  POLAR_CREDITS_APP_REVIEWS_PRODUCT_ID; do
  value=${!key:-}
  test -n "$value" || { printf 'Missing %s\n' "$key" >&2; exit 1; }
  "$DEPLOY_SECRET_SET" "$key" "$value"
done
"$DEPLOY_SECRET_SET" PROVIDER_APP_DATA dataforseo
for flag in APP_SEO_ENABLED APP_RESEARCH_ENABLED APP_LISTING_AUDITS_ENABLED APP_CHART_TRACKING_ENABLED APP_KEYWORD_TRACKING_ENABLED APP_REVIEWS_ENABLED; do
  "$DEPLOY_SECRET_SET" "$flag" false
done
docker compose up -d --build
docker compose ps
```

Remove the temporary local ID record after the deployment secret store confirms all five values. Product IDs are catalog identifiers, but the record should not linger in the working tree.

## 3. Enable flags in ascending blast radius

Before each stage, confirm `api`, `worker`, and `web` are healthy. Open Superadmin Intelligence at the costs and queues views. Record aggregate counts, cost in micros, queue age, failure count, and DLQ count only. Do not copy customer content.

Use this helper for every flag change:

```bash
enable_app_seo_flag() {
  flag=$1
  "$DEPLOY_SECRET_SET" "$flag" true
  docker compose up -d --no-deps --force-recreate api worker web
  docker compose ps
  docker compose logs --since=10m api worker | rg 'app.seo|app-seo|dead-letter|provider.cost' || true
}
```

1. Enable `APP_SEO_ENABLED`. This registers profiles and enables stored cross-store reads without starting vendor spend. Observe for 15 minutes. Watch authentication and ownership refusals, request rate limits, queue counts, and unexpected provider-cost events. Any App SEO provider cost at this stage is a rollback condition.

   ```bash
   enable_app_seo_flag APP_SEO_ENABLED
   ```

2. Enable `APP_RESEARCH_ENABLED`. Run one Pro or Agency canary research request in the supported US English market. Observe for 30 minutes. Watch the App SEO cost rows, cache outcomes, shared create-rate bucket, partial results, and DLQ. Confirm a stored result reopens without a new cost event.

   ```bash
   enable_app_seo_flag APP_RESEARCH_ENABLED
   ```

3. Enable `APP_LISTING_AUDITS_ENABLED`, then `APP_CHART_TRACKING_ENABLED`. Run one canary for each task-based surface and observe for 60 minutes after the second flip. Watch reservation settlement, partial-store outcomes, chart task polling, queue age, provider costs, and DLQ. Stored reads must remain free of new provider-cost events.

   ```bash
   enable_app_seo_flag APP_LISTING_AUDITS_ENABLED
   enable_app_seo_flag APP_CHART_TRACKING_ENABLED
   ```

4. Enable `APP_KEYWORD_TRACKING_ENABLED`. This introduces scheduled recurring spend. Add one canary keyword and observe through one complete weekly scheduler window. Watch scheduler receipts, duplicate suppression, reserved and consumed keyword units, provider cost, queue age, and DLQ. Do not shorten the window by backfilling old weeks.

   ```bash
   enable_app_seo_flag APP_KEYWORD_TRACKING_ENABLED
   ```

5. Enable `APP_REVIEWS_ENABLED`. Run one bounded canary review analysis and observe for 60 minutes. Watch review-fetch and AI-cost rows separately, the configured AI ceiling, partial and insufficient-evidence outcomes, reservation settlement, queue age, and DLQ.

   ```bash
   enable_app_seo_flag APP_REVIEWS_ENABLED
   ```

Move to the next stage only when costs match the canary volume, the DLQ is empty, queue age returns to baseline, stored reads work, and no cross-account data appears. There is no backfill at any stage. Schedulers begin with the next eligible weekly receipt, and every on-demand surface waits for a user request.

## 4. Hold conditions and observation record

Return the narrowest affected flag to false if provider cost appears before its stage, one canary creates duplicate reservations, queue age grows across two observation samples, the DLQ gains an App SEO job, refunds or consumption settle more than once, a US English restriction is bypassed, stored reads trigger spend, or output crosses an account boundary.

For each stage, record the UTC start and end time, flag value, canary account ID, canary run ID, aggregate provider cost, queue maximum age, terminal state, and DLQ count. Account and run IDs are safe operational references. Do not record app names, store URLs, keywords, review text, prompts, or provider payloads.

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ'
docker compose ps
docker compose logs --since=15m worker | rg 'app.seo|app-seo|dead-letter|provider.cost' || true
```

## 5. Rollback

Rollback is a flag change, not a data operation. Set the narrowest affected flag to false. For an unknown or multi-surface incident, turn off all child flags first and the master flag last:

```bash
for flag in APP_REVIEWS_ENABLED APP_KEYWORD_TRACKING_ENABLED APP_CHART_TRACKING_ENABLED APP_LISTING_AUDITS_ENABLED APP_RESEARCH_ENABLED APP_SEO_ENABLED; do
  "$DEPLOY_SECRET_SET" "$flag" false
done
docker compose up -d --no-deps --force-recreate api worker web
docker compose ps
docker compose logs --since=15m api worker | rg 'app.seo|app-seo|dead-letter|provider.cost' || true
```

Confirm that new work returns the localized unavailable response, no refused request creates a provider-cost event, accepted jobs finish or reconcile to one terminal settlement, and stored results still open. The batch [README rollout contract](../../prompts/rankme-app-seo/README.md) states that false flags refuse new work, preserve stored reads, and let queued or running jobs finish consistently.

Do not change `PROVIDER_APP_DATA` to `fake` in production, delete rows, reverse migrations, edit usage ledgers, or replay provider calls as rollback. No backfill is needed after rollback or re-enable. The next weekly scheduler receipt and new user requests resume the system from its stored state.
