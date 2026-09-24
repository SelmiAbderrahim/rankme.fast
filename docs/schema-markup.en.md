---
title: 'Schema markup generator'
description: 'How RankMeFast builds JSON-LD from stored page facts, what conformance means here, and why a missing property is omitted rather than invented.'
locale: en
slug: schema-markup
section: product
order: 10
---

# Schema markup generator

The generator writes JSON-LD for a page from facts RankMeFast already holds: an audited page, an inventory page, or a URL you paste in. You copy or download the result.

<!-- docs-truth: metric=schema_generations; unit=one-generation-one-page-one-type; cache-hits=count; refund=missing-evidence-omitted-with-reason; cadence=on-demand; estimates=first-party-facts -->

## Types and evidence

Seven types are supported: `WebPage`, `WebSite`, `Organization`, `Article`, `BreadcrumbList`, `FAQPage`, and `HowTo`. You choose the type and RankMeFast gathers the evidence.

Each property in the output is tied to the stored fact it came from, so you can trace every value back to its page before you publish anything.

## The conformance report

The conformance check sorts what it finds into two groups:

- **Required gaps**: properties the type needs.
- **Suggestions**: properties that would make the markup stronger.

Passing means the output meets schema.org's requirements for the type you picked. It's never a guarantee that Google will show a rich result.

## Why properties go missing

If there's no stored evidence for a property, it's left out and the report says why. Ratings, prices, reviews, authors, and dates are never made up.

That's why `Article` often shows a `datePublished` gap. When the page doesn't expose a publication date RankMeFast can read, the generator tells you instead of guessing one.

## How values are checked

An AI model chooses which properties to fill. A post-check then compares each value with its stored fact, and anything that isn't a verbatim copy is rejected before you see it.

You add the markup to your site yourself. RankMeFast doesn't inject it into your site, theme, or tag manager, and it holds no credentials that would let it.

For units and plan limits, see [Pricing](./pricing.en.md).

[Back to the docs index](./index.en.md)
