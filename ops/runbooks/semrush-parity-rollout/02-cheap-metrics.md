# 02 — Link, Traffic, then Trends

Enable these flags one at a time, in this order:

1. `LINK_INTELLIGENCE_ENABLED`
2. `TRAFFIC_INSIGHTS_ENABLED`
3. `KEYWORD_TRENDS_ENABLED`

For every canary, record the preview, usage before and after, terminal state,
retained result identifier, and superadmin panel observations. Do not record
the submitted domain or keywords in operator notes.

## Link Intelligence

1. Set `LINK_INTELLIGENCE_ENABLED=true` and use `README.md` to recreate and
   check the services.
2. Preview, then submit one deep pull. Submit one gap run with one competitor.
   Confirm each normalized leg moves `link_intel_checks` exactly once.
3. Repeat one cacheable request and confirm the response identifies the cache
   while the unit still counts. Confirm a successful empty result also counts.
4. In `/superadmin?tab=intelligence&intel=queues`, check `backlink-deep` has
   no unexpected waiting, failed, or dead-letter growth. Check Providers,
   Costs, and Quality for provider failures, the metric movement, and the
   refund rate.
5. Where the controlled provider fixture supports it, run one failed
   zero-retained leg and confirm exactly that leg is refunded once. Do not
   force a live provider failure.

Rollback: set `LINK_INTELLIGENCE_ENABLED=false`, recreate both services,
confirm new deep/gap previews and mutations are unavailable, then reopen the
known stored gap/deep result. Its stored read must still work.

## Traffic Insights

1. Set `TRAFFIC_INSIGHTS_ENABLED=true` and use the common flip procedure.
2. Preview and submit one target-domain snapshot. Confirm
   `traffic_snapshots` moves once and every numeric result remains labeled as
   an estimate from a provider index.
3. Confirm a retained partial result consumes. Under a controlled fixture,
   confirm only an all-provider-failed result with no retained snapshot
   refunds once.
4. Check `traffic-snapshots` in Queues, then Providers, Costs, and Quality.
   There must be no unexpected failed/dead-letter growth or unlabeled value.

Rollback: set `TRAFFIC_INSIGHTS_ENABLED=false`, recreate both services,
confirm new preview/submission is unavailable, then reopen and compare known
stored snapshots. Both reads must still work.

## Keyword Trends

1. Set `KEYWORD_TRENDS_ENABLED=true` and use the common flip procedure.
2. Preview and explore one to five keywords. Confirm the entire exploration
   moves `trend_explorations` once, not once per keyword.
3. Repeat a cacheable exploration and confirm it still counts. A successful
   empty or sparse series also counts; only a provider failure with no
   retained series refunds once.
4. Check Providers, Costs, and Quality. Trends is synchronous and has no
   dedicated market queue, so no queue row should be invented or
   required. Every value must remain labeled as an estimated search-interest
   index rather than absolute search volume.

Rollback: set `KEYWORD_TRENDS_ENABLED=false`, recreate both services, confirm
new preview/exploration is unavailable, then reopen the known stored
exploration. Its read must still work.

