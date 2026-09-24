---
title: 'Plans, limits & credits'
description: 'Starter, Pro, and Agency caps and overage credits.'
locale: en
slug: plans-limits-credits
section: account
order: 2
---

# Plans, limits & credits

<!-- generated: finite-free-intro:start -->
RankMeFast has three paid subscription tiers: Starter, Pro, and Agency.
<!-- generated: finite-free-intro:end -->

## Custom plans

Besides the fixed plans and credit packs, you can build your own plan on **Pricing** or under **Billing → Custom plan**. You pick monthly allowances, how many sites and seats you need, which features to switch on, and how often ranks are checked. Each control has its own minimum, maximum, and step, and some options depend on or rule out others. The price in the browser is only an estimate; the server sets the actual quote.

Monthly allowances on a custom plan reset on your billing date each month (UTC). A yearly purchase gives you 12 of those monthly allowances. Sites, keywords, and seats don't reset: delete one and its slot is free again. Per-run limits, such as pages per audit, apply to each run.

Paying yearly takes up to 20% off the cost of 12 monthly payments. The preview shows the discount you actually get after minimums, rounding up, and our cost floor. If the full discount would take the price below that floor, you see a smaller discount, no discount, or no yearly option at all. We never show a discount you won't get.

Signed-in owners with a verified email can lock in a quote for 30 minutes. The checkout button appears only when the server confirms purchases are open. Prices are in USD, and Polar adds any tax at checkout. In sandbox mode, when payments aren't set up, when pricing data is out of date, or when sales are paused, you can still preview a plan but you can't buy it.

A custom plan starts once its payment is confirmed. There's no trial, coupon, wallet credit, or mid-period proration. What you paid for stays in place until the period ends. Changing the plan, switching between monthly and yearly, or moving between a fixed and a custom plan all need a new checkout at the end of the paid period. If your renewal needs a new price, accept it before the deadline shown or the plan won't renew. Cancelling takes effect at the end of the period. Credit pack balances that still apply carry over, and recurring add-ons are never quietly merged into your custom limits. Refunds follow the terms shown at checkout. If a late charge goes through at a price that wasn't safe, we refund it in full automatically.

## The three tiers

<!-- generated: finite-plan-table:start -->
<!-- source: tiers.ts -->
| Plan     | Monthly (USD) | Yearly (USD) | Sites | Keywords | Audits/month | Audit pages | Backlink rows | AI summaries | Seats | Audience Research runs |
|----------|---------------|--------------|-------|----------|--------------|-------------|---------------|--------------|-------|------------------------|
| Starter  | $49           | $470.40      | 2     | 250      | 10           | 1,000       | 0             | 20           | 1     | 2                      |
| Pro      | $159          | $1,526.40    | 5     | 1,000    | 30           | 3,000       | 10,000        | 100          | 3     | 10                     |
| Agency   | $499          | $4,790.40    | 50    | 2,000 | 45           | 5,000       | 100,000       | 480          | 15    | 30                 |
<!-- generated: finite-plan-table:end -->

Prices above are in USD. Yearly billing is 20% off the monthly total. Daily rank tracking is a paid add-on on every plan and isn't included in any of them.

<!-- generated: finite-limit-semantics:start -->
**How limits reset.** Sites, tracked keywords and seats count what you have right now, so removing one frees its slot. Audits, rank checks, backlink rows, AI work and other metered units reset at the start of each calendar month (UTC). Each audit also has its own page cap. Purchased packs stay on the account until you use them. Recurring add-ons add only the amount shown in Billing.
<!-- generated: finite-limit-semantics:end -->

## Audience Research runs

<!-- source: tiers.ts -->
One run is one whole research job, no matter how many pages it reads. Starter accounts get 2 runs, Pro 10, and Agency 30 per month. There's no credit pack for runs. If you hit the cap, wait for the monthly reset or upgrade. See [Audience Research](./audience-research.en.md).

## Keyword Intelligence and Weekly Pulse units

<!-- source: tiers.ts -->
- A keyword gap check uses one `keyword_lookups` unit per competitor you compare.
- A keyword overview or trends read uses one `keyword_lookups` unit per keyword. Results served from cache still count.
- Clustering a keyword list uses one `ai_summaries` unit; rerunning the identical list is free.
- One Weekly Pulse digest uses one `ai_mentions_checks` unit per site per week, no matter how many teammates receive it.

Details live in [Keyword Intelligence](./keyword-intelligence.en.md) and [Weekly Pulse](./weekly-pulse.en.md).

### Competitor Intelligence limits

Competitor Intelligence starts on Pro. A Pro landscape can include up to three confirmed competitors, while Agency can include up to ten. Each selected competitor uses one `keyword_lookups` unit. An optional discovery refresh uses one more unit after a separate confirmation. Agency ranking-page content comparison is a separate workflow and uses one `competitor_content_runs` unit per confirmed run. Reading a stored report, reviewing a page match, accepting a recommendation, or exporting a report uses none of those units. See [Backlinks and Competitor Intelligence](./backlinks-competitors.en.md).

## AI Assistant messages

<!-- source: tiers.ts ai-chat -->
One unit is one message you send to the AI Assistant. Starter accounts get 100 messages, Pro 200, and Agency 400 per month. Cache hits and stopped replies still count. A one-time pack adds 100 messages for $19 under **Billing → Credits**.

## Intelligence allowances and units

<!-- source: tiers.ts intelligence-caps -->
| Plan | Keyword Trends explorations | Traffic snapshots | Link Intelligence checks | Review syncs | Brand Radar scans |
|---|---:|---:|---:|---:|---:|
| Starter | 10 | 5 | 0 | 0 | 0 |
| Pro | 40 | 25 | 25 | 10 | 0 |
| Agency | 80 | 80 | 80 | 50 | 20 |

One Trends unit covers up to five phrases. One Traffic unit covers one target domain. One Link unit covers one deep pull or one competitor leg in a gap run. One Review unit covers a whole one-to-three-source sync. One Brand Radar unit covers one brand query and its cited digest.

Results from cache count, and so do searches that succeed but find nothing. You get a unit back (once) only if the data source fails before the feature has saved anything useful. Multi-part Link, Traffic, and Review jobs apply that rule to each part; see [Link Intelligence](./link-intelligence.en.md), [Traffic Insights](./traffic-insights.en.md), [Keyword Trends](./keyword-trends.en.md), [Review Intelligence](./review-intelligence.en.md), and [Brand Radar](./brand-radar.en.md).

## Brand Radar add-on and intelligence packs

<!-- source: tiers.ts intelligence-products -->
<!-- intelligence-products: brand-addon=60@1900; brand-scans-40=40@2900; link-intel-100=50@1900; review-syncs-100=50@1900; traffic-snapshots-100=100@1900; trend-explorations-200=200@1900 -->
Pro and Agency can add 60 Brand Radar scans per month for $19/month. Agency's 20 base scans remain available without the add-on; Pro's base is zero.

The one-time packs are 40 Brand Radar scans for $29, 50 Link checks for $19, 50 Review syncs for $19, 100 Traffic snapshots for $19, and 200 Trends explorations for $19. Purchased pack balances remain until used. You can always see what's on sale on [Pricing](./pricing.en.md) and under **Billing → Credits**.

## App SEO limits, add-on, and packs

<!-- source: tiers.ts app-seo-caps -->
| Plan | App keyword checks | Listing audits | Chart checks | Keyword research | Competitor runs | Review runs | App profiles | Tracked app keywords |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pro | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 25 |
| Agency | 50 | 4 | 20 | 2 | 0 | 0 | 5 | 50 |

<!-- source: tiers.ts app-seo-products -->
<!-- app-seo-products: addon=app_keyword_checks:600,app_listing_audits:8,app_chart_checks:60,app_keyword_lookups:40,app_competitor_lookups:10,app_review_runs:10@2900; app-keyword-checks-500=500@1900; app-research-50=50@1900; app-competitors-20=20@1900; app-review-runs-10=10@1900 -->
Pro and Agency can add 600 keyword checks, 8 listing audits, 60 chart checks, 40 research pages, 10 competitor runs, and 10 review runs each month for $29/month. Agency keeps its base allowance in addition to the add-on.

Four one-time packs are available on Pro and Agency: 500 keyword checks, 50 research pages, 20 competitor runs, or 10 review runs. Each pack costs $19. Pack credits stay on the account until used and are consumed only after the monthly allowance.

## Trial availability
Trials are optional and are not included with every paid tier. If an offer has a trial, its length and first charge date appear at checkout before you confirm payment.

## What happens at a cap
When you hit a monthly cap (audits, tracked keywords, backlink rows, AI summaries), that action is blocked and the message points you to two options:
1. Upgrading to a higher tier.
2. Buying an **overage credit pack** for the matching metric.

Nothing else on the account changes. Your existing sites, keywords, and reports stay as they are.

## Overage credit packs
Small one-time packs of extra usage, priced per metric. Each one tops up the matching cap and stays on the account until used. Subscribers find them under Billing → Credits.

## Cancelling and downgrading
Cancelling keeps your access until the end of the billing period. Downgrading takes effect at the next renewal. Extra sites and keywords aren't deleted; they become read-only until you delete some or upgrade again.

## Enterprise plans
<!-- generated: finite-enterprise-plan:start -->
Enterprise starts with 100 live sites and 25 seats. The agreement records any higher caps, each a set number; any limit it leaves out keeps its Enterprise baseline. See [Enterprise plans](./enterprise.en.md).
<!-- generated: finite-enterprise-plan:end -->

[Back to the docs index](./index.en.md)
