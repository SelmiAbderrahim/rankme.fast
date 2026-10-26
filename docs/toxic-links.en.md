---
title: 'Toxic links and disavow'
description: 'How RankMeFast sorts backlinks into risk levels with fixed rules, when AI may annotate a row, and why the disavow file is never submitted for you.'
locale: en
slug: toxic-links
section: product
order: 5
---

# Toxic links and disavow

A toxicity review scores backlink rows you have already fetched against fixed rules, then lets you build a Google-format disavow file. RankMeFast never submits that file.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## How rows get a risk level

The rules (version `toxicity-rubric-v1`) read the spam score on each saved backlink row and place it at a clean, watch, or toxic risk level. Broken-link and nofollow signals adjust the level.

The rules give the same result every time: the same saved rows and the same spam scores always produce the same risk levels, and each level is shown with the evidence behind it.

## What a review costs

A review snapshots up to 1,000 rows you've already fetched and pays for at most 100 fresh domain spam scores. If the site has no stored backlink rows yet, load its backlink list first.

You can ask for an AI rationale on a flagged row. It either cites that stored row or declines to comment. If the provider step fails, nothing is kept and the unit is returned.

## Building the disavow file

1. Include or exclude each row.
2. Choose domain or URL scope.
3. Export a plain `.txt` file in Google's format. Excluded rows are left out.

RankMeFast exports the file for your own review and submission to Google. It isn't connected to the Search Console disavow tool and can't upload anything on your behalf.

## Honest limits

A risk level describes what the rules found in a link. It is never a prediction of a Google penalty, a manual action, or a ranking change.

AI may annotate a row the rules already flagged, but it can never add a domain the rules did not flag. Every domain in the export traces back to a saved row.

Before acting, compare this guide with the stored evidence and status shown in RankMeFast.

See [Pricing](./pricing.en.md) for units and plan limits.

[Back to the docs index](./index.en.md)
