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

Each property in the output is tied to the stored fact it came from, so you can trace every value back to its page before you publish anything. `FAQPage` and `HowTo` come last in the list, each with a short note. Google shows FAQ answers in search results only for well-known government and health sites, and it no longer shows HowTo steps at all. Both types still produce valid schema.org markup.

## The conformance report

The conformance check sorts what it finds into two groups:

- **Required gaps**: properties the type needs.
- **Suggestions**: properties that would make the markup stronger.

Passing means the output meets schema.org's requirements for the type you picked. It's never a guarantee that Google will show a rich result.

## Why properties go missing

If there's no stored evidence for a property, it's left out and the report says why. Ratings, prices, reviews, authors, and dates are never made up. That's why `Article` often shows a `datePublished` gap. When the page doesn't expose a publication date RankMeFast can read, the generator tells you instead of guessing one.

## Names and facts you add

For `WebSite` and `Organization`, the name comes from the first source the page offers: its `og:site_name` tag, then a name already declared by `Organization` or `WebSite` markup on the page, then the brand part of the page title (separators and words such as "Welcome" are dropped), then the name you gave the site, and only then the domain. The evidence list shows which source was used. Under **What we left out**, you can type a value for properties such as the description, language, dates, or image addresses. The generator adds it exactly as written and marks it **Provided by you**. Choose **Rebuild with my facts** to apply them. The rebuild reuses the facts the original generation already found, makes no new AI call, and uses no generation. The original stays unchanged and the rebuild is saved as a new generation.

## How values are checked

An AI model chooses which properties to fill. A post-check then compares each value with its stored fact, and anything that isn't a verbatim copy is rejected before you see it.

You add the markup to your site yourself. RankMeFast doesn't inject it into your site, theme, or tag manager, and it holds no credentials that would let it.

[Back to the docs index](./index.en.md)
