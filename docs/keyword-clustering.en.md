---
title: 'Keyword clustering'
description: 'How RankMeFast groups tracked keywords by shared result URLs, and why grouping is arithmetic rather than a similarity score.'
locale: en
slug: keyword-clustering
section: product
order: 2
---

# Keyword clustering

Clustering groups your tracked keywords by how many result URLs they share. It works only from SERP observations RankMeFast has already stored and never runs a rank check to fill a gap.

<!-- docs-truth: metric=keyword_cluster_runs; unit=one-run-up-to-200-keywords; cache-hits=count; refund=none-blocked-keywords-are-reported; cadence=on-demand; estimates=shared-url-arithmetic -->

## How a cluster forms

1. For each keyword, RankMeFast takes the top 10 result URLs from its most recent stored observation.
2. Two keywords are linked when they share at least 3 of those URLs.
3. Links chain together: if A links to B and B links to C, all three land in the same cluster.

A run covers up to 200 keywords. Membership is plain arithmetic on shared URLs, so the same stored observations always give the same clusters.

## Which keywords can join

Only Google keywords with an observation from the last 7 days take part. Before a run starts, a preflight check shows you which ones qualify.

Keywords that can't take part are listed with a reason (missing, stale, or empty) instead of disappearing quietly. The run uses its unit once it starts, and blocked keywords aren't refunded.

## Labels

The AI runtime may suggest a name for each cluster, shown with an AI marker. If labelling fails you get unnamed clusters. The grouping itself doesn't change, because it never depends on the model.

Three shared URLs is a cut-off, not a similarity score, and a cluster says nothing about search intent. RankMeFast never makes up a keyword, URL, or observation to round out a group.

## Plans and availability

Monthly allowances by plan:

- Starter: 0
- Pro: 4
- Agency: 20

An operator can turn clustering off with the `KEYWORD_CLUSTERING_ENABLED` flag. New runs are then refused with a localized message, and clusters you already have stay readable. [Pricing](./pricing.en.md) explains how units work.

[Back to the docs index](./index.en.md)
