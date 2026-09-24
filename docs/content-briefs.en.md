---
title: 'Content briefs'
description: 'How a brief is built from the stored top-ten SERP and up to ten page scrapes, and why every outline node must cite supplied evidence.'
locale: en
slug: content-briefs
section: product
order: 8
---

# Content briefs

A brief is built for one tracked keyword. RankMeFast takes the stored top-ten SERP plus up to ten page scrapes and turns them into an outline and a set of questions you can write against.

<!-- docs-truth: metric=content_briefs; unit=one-brief-up-to-ten-scrapes; cache-hits=count; refund=abstains-rather-than-invents; cadence=on-demand; estimates=ai-interpretation-labeled -->

## What's in a brief

It starts with plain statistics from the scraped pages:

- the word-count range and average
- a histogram of headings
- the structured-data types the pages declare

Then the AI runtime writes an outline and a question set.

Each outline node and each question has to cite something that was supplied: a stored document, one of the statistics, a People Also Ask row, or a cluster term.

If a node or question can't point to evidence, it's dropped. The brief leaves a gap rather than inventing a source.

## Drafting and re-scoring

The draft editor scores your text against the same statistics the brief was built from, so when the score moves you can see why. There's no hidden model opinion behind it.

Re-scoring reuses the stored statistics and doesn't cost another unit. A brief costs one unit whether the SERP came from storage or from a fresh check.

## Check the date

The statistics describe the specific pages scraped on a given date, and that date is printed next to them. Read them as a snapshot, not a permanent picture of "the top 10".

## Availability

Briefs come with the Agency plan. On Pro you get them through the `content-briefs-10` credit pack, and Starter has no brief allowance. See [Pricing](./pricing.en.md) for units and plan limits.

A brief is guidance. It doesn't estimate your chances of ranking, and RankMeFast never publishes anything to your site.

[Back to the docs index](./index.en.md)
