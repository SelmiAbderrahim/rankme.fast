---
title: 'AI summary'
description: 'What it does, what we send, and why it never changes the audit.'
locale: en
slug: ai-summary
section: audits
order: 2
---

# AI summary

The AI summary sits above the tabs on the report screen. It reads your audit and writes a short paragraph, in your language, about which fixes to do first.

## What it does
It's a plain-language brief: which findings matter most, why, and roughly where to start. It doesn't add findings. It retells the ones the audit already produced.

## What we send
Only two things go to the AI model:
1. The text of your audit findings: the same rule titles, explanations and fixes you see on screen.
2. The affected URLs, so the summary can refer to them.

Search Console data, screenshots, billing details and your other sites are not sent.

## Why it can't change the audit
The audit gives the same result for the same input every time. The summary is a separate step that runs *after* the audit finishes and only reads the finished snapshot. Turning the summary off doesn't move any rule to a different tab.

## Regenerating
Click **Regenerate** on the summary card to run it again. Each run uses one summary credit (see the AI summaries cap in [Plans, limits & credits](./plans-limits-credits.en.md)). Once you reach the cap, the card shows a limit notice instead, and those blocked attempts don't use credit.

## Which model is used
The summary uses the AI providers configured by whoever runs your RankMeFast installation, tried in order. Very long lists of findings are shortened before they're sent, and the card then shows a "shortened" note.

[Back to the docs index](./index.en.md)
