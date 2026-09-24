---
title: 'Toxic links and disavow'
description: 'How RankMeFast bands backlinks with a fixed rubric, when AI may annotate a row, and why the disavow file is never submitted for you.'
locale: en
slug: toxic-links
section: product
order: 5
---

# Toxic links and disavow

A toxicity review scores backlink rows you've already fetched against a fixed rubric. From there you can build a disavow file in Google's format. RankMeFast never submits it for you.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## How rows are banded

The rubric, `toxicity-rubric-v1`, reads the provider's spam score on each stored backlink row and puts the row in a clean, watch, or toxic band. Broken-link and nofollow signals can shift the band.

The same rows with the same spam scores always land in the same bands, and each band is shown next to the evidence behind it.

## What a review costs

A review snapshots up to 1,000 rows you've already fetched and pays for at most 100 fresh domain spam scores. If the site has no stored backlink rows yet, load its backlink list first.

You can ask for an AI rationale on a flagged row. It either cites that stored row or declines to comment. If the provider step fails, nothing is kept and the unit is returned.

## Building the disavow file

1. Include or exclude each row.
2. Choose domain or URL scope.
3. Export a plain `.txt` file in Google's format. Excluded rows are left out.

RankMeFast exports the file for your own review and submission to Google. It isn't connected to the Search Console disavow tool and can't upload anything on your behalf.

## What a band means

A band is what the rubric says about a link. It doesn't predict a Google penalty, a manual action, or a ranking change.

The AI can comment on a row the rubric already flagged, but it can't add a domain the rubric didn't flag. Every domain in the export traces back to a stored row.

See [Pricing](./pricing.en.md) for units and plan limits.

[Back to the docs index](./index.en.md)
