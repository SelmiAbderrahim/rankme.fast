---
title: 'Generative AI appearance in Search Console'
description: 'How often Google showed your site inside its generative AI features, straight from Search Console.'
locale: en
slug: gsc-generative-appearance
section: research
order: 4
---

# Generative AI appearance in Search Console

Google Search Console reports how often your pages appeared inside Google's generative AI features, such as AI Overviews. This card shows those numbers as Google sends them. We don't add or estimate anything.

## What we read

We ask the Search Console API for `dimensions=['searchAppearance']` over the last 28 days, ending three days ago to match Google's reporting lag. Each row Google returns is classified using Google's own documentation:

- Known generative AI values get a stable label.
- Unknown values show up as `Other`, with the raw name kept so support can review it. We never guess that an unknown value is generative.

## States

- **Available**: Google returned at least one recognized generative AI row. The card shows the clicks, impressions, CTR and average position Google sent for each row.
- **Unavailable**: Google returned no recognized generative AI row for this property and time window. That's different from zero. Google didn't report the feature at all, so we leave it blank instead of showing 0.
- **Partial**: Google returned rows but marked the response as partial (because of a rate limit or truncation). The rows we did get are still shown.
- **Reconnect required**: your Google connection needs to be reconnected. Open the site's Google workspace and follow the reconnect prompt.

## Separate from provider metrics

This is Google's own data about your site. It sits on the Google workspace next to your other Search Console cards. It isn't mixed into the mention and share-of-voice charts on the AI Visibility workspace, which come from a different provider and measure something else.

## What this doesn't tell you

Search Console counts impressions and clicks: how often Google included your page in a generative AI feature. It doesn't say whether the AI answer named you, linked to you, quoted you or preferred a competitor. For that, use [AI Visibility](./ai-visibility.en.md).

[Back to the docs index](./index.en.md)
