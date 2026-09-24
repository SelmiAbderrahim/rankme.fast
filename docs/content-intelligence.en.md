---
title: 'Content Intelligence'
description: 'Analyze a page you own, score it, and get a plain-language brief with citations.'
locale: en
slug: content-intelligence
section: audits
order: 3
---

# Content Intelligence

Content Intelligence looks at a page you own and gives you a readiness
score, the evidence behind it, a plain-language brief and, if you opt in,
an AI-written draft. The score is rule-based, so the same page always gets
the same score. One analysis uses one `content_analyses` credit from your
monthly allowance or your credit pack.

## What it does

- Fetches an eligible page through the configured crawl service.
- Pulls out headings, links, structured data, and a few other on-page
  signals. It doesn't keep the raw HTML of third-party pages.
- Scores the page with the same rules as the audit report, so the numbers
  are comparable.
- Shows evidence for every finding: the rule id, where it fired, a short
  excerpt, and a confidence label.
- If you opt in, sends the page to the AI providers your operator has
  configured to write a brief and, optionally, a draft.

## What it doesn't do

- It doesn't publish anything. Drafts are yours to accept, edit, or dismiss.
- It doesn't crawl arbitrary URLs. The URL must belong to a site you own or
  a competitor you have added on the Agency tier.
- It doesn't show raw provider responses or hidden AI instructions. The app
  shows a cleaned-up result, and `/api/v1` can't start or change analyses.

## Starting an analysis

You can start an analysis from:

- **Sites → any site → Content:** pick a page URL from your inventory.
- **Report → Fix now / Watch:** the recommendation row opens the workflow
  with the page filled in.
- **Keyword research → tracked keyword:** analyzes the URL that ranks for
  the keyword right now.
- **Google Search Console → any query:** analyzes the URL Google shows
  for that query.
- **Competitors → Agency competitor page:** Agency tier only.

All of these open the same workflow. Each one checks and reserves your
allowance before the analysis is queued (see
[Plans, limits & credits](./plans-limits-credits.en.md)), and stops with a
clear message if you're over your cap.

## What one credit includes

One `content_analyses` credit covers:

- one fetch of your page plus up to three reviewed public comparison pages,
- the keyword and search-result evidence available for that run,
- the score and its evidence,
- the plain-language brief,
- and, when opt-in AI is on, one draft.

Regenerating uses another credit. If you retry the same URL within seven
days, RankMeFast reuses the saved copy of the page, but the new score and
brief still cost one credit.

## Score, evidence, confidence, citations, brief, draft

- **Score.** 0 to 100, from the same rules as the audit report.
- **Evidence.** Each finding names the rule, points to the place in the
  HTML where it fired, and shows a short excerpt.
- **Confidence.** `high` / `medium` / `low`, based on how well structured
  the page is.
- **Citations.** Every AI statement cites the URL and excerpt it came from.
  Anything without a citation is hidden.
- **Brief.** A short, plain-language plan you can hand to a writer.
- **Draft.** Opt-in. The AI provider order in the operator config decides
  who writes it. You accept, edit, or dismiss it.

## Opt-in AI processing and retention

The AI brief and draft are opt-in. When you opt in, we send only the
excerpts needed to write the brief. We keep those excerpts for seven days
so you can regenerate without a second fetch, then delete them. The export
and account-deletion controls in
[Account security](./settings-security.en.md) still apply and finish
within the documented grace period.

## Partial and refunded results

Sometimes Firecrawl or the AI provider has problems. In that case the
analysis shows whatever finished and is marked `partial`. Regenerating
starts a new analysis and uses another credit. If the run failed before
producing anything useful, the credit is refunded automatically and the
analysis is marked `refunded`.

## Recommendations and 28-day correlations

The brief lists recommendations. For each one you can:

- **Accept:** adds it to your outcome tracking.
- **Dismiss:** records why, for the correlation window.
- **Apply:** marks it applied. RankMeFast then compares rank, clicks, and
  impressions for the 28 days before and after.

This comparison shows whether the numbers moved after the change. It
doesn't prove the change caused it. The audit report uses the same 28-day
window.

## Pro inventory and cannibalization

On Pro and Agency, the workspace opens a page inventory that groups URLs
by topic and flags cannibalization pairs (two of your own URLs competing
for the same search intent). Inventory has its own allowance,
`content_inventory_page_blocks`: one block covers up to four of your pages,
rounded up. Unused whole blocks are refunded when the run finishes.

## Agency competitor portfolio and monitoring

Agency comparisons start from reviewed ranking pages rather than competitor
homepages. Open a landscape report, check the suggested page and its keyword
evidence, then confirm it or enter another page on the same domain.
RankMeFast doesn't start paid work from a suggestion alone, and it won't
quietly swap an unavailable page for the homepage.

A confirmed content run can compare up to 15 reviewed competitor pages with
the pages from your site that you selected. Before anything is reserved, the
review step shows the page count and the units it will use. RankMeFast keeps
the facts it derived and short excerpts, not raw HTML, and the excerpts
expire after seven days.

Monitoring is a separate step. “Monitor this reviewed page” opens the
usual monitor form, where you confirm the exact URL before it takes a
monitor slot. Analysis never creates a monitor on its own, and the weekly
check schedule and your plan allowance still apply. Once you dismiss a
Firecrawl change, the same change doesn't alert again.

You can also open a focused content analysis from a landscape opportunity.
Your URL, the keyword, and the reviewed competitor page are filled in, but
you still confirm before the analysis starts.

## Managing allowances and the 20-analysis pack

Your monthly `content_analyses` allowance depends on your tier. See
[Plans, limits & credits](./plans-limits-credits.en.md). If you run out
mid-month, the 20-analysis credit pack adds twenty single-use credits that
never expire and come on top of the monthly allowance.

## Troubleshooting

- **Access.** The URL must belong to a site you own (or an Agency
  competitor). Otherwise you get "not found" rather than "forbidden", so the
  response doesn't reveal whether the URL exists.
- **robots.txt.** If your own page blocks the crawl, the run fails and the
  credit is refunded. If an optional comparison page is blocked, you may get
  a `partial` result. RankMeFast always follows robots rules.
- **New URLs in Search Console.** If Google hasn't indexed the URL yet, the
  analysis still runs on the fetched HTML but skips the Search Console
  comparison.
- **Caps.** You'll see a message that names the metric
  (`content_analyses`). Buy a pack or wait for the monthly reset.
- **Provider outages.** A Firecrawl or AI provider outage shows up as
  `partial` or `refunded`. It is never reported as a success.

## Using it from MCP

If you use Claude Code, Claude Desktop, Cursor, or VS Code, you can run
Content Intelligence through the RankMeFast MCP endpoint. See
[RankMeFast MCP](./rankmefast-mcp.en.md).

## Export and deletion

Every analysis is included in the account export. Deleting your account
removes your analyses within the grace period described in
[Account security](./settings-security.en.md).
