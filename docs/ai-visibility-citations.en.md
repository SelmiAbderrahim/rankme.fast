---
title: 'AI citations & source gaps'
description: 'Sampled prompt checks: which sources AI answers cite, and where you are missing.'
locale: en
slug: ai-visibility-citations
section: audits
order: 10
---

# AI citations & source gaps

AI Visibility checks what AI assistants answer for the prompts you track, and which sources those answers cite.

## A sample, never full coverage

You track a small set of prompts per site (up to ten). One check asks those prompts across the engines your plan covers, so the result is a sample of what people might see (sample size = prompts × cohort). It doesn't cover everything people ask an AI.

## Supported engines

Mention checks read the provider's mentions index for Google and ChatGPT results. Answer checks cover ChatGPT, Gemini, and Claude; Perplexity supports live answers only. If the provider reports a new AI product, it shows up under the provider's own name.

## Citations

A citation is a URL plus the identity of the source the answer pointed at. We record the cited URL whenever the engine reports one, and whether an answer cited you or a tracked competitor.

## Source gaps

A source gap means answers in your topic cite other sources but never yours. Source gaps show up as items in [Next Actions](./next-actions.en.md), each pointing at the sources the engines preferred.

## States

- **Partial results**: some engines returned data, others did not. We show what arrived and name what is missing.
- **Unsupported for this engine / market**: the engine can't run this check where you are. It's left out rather than shown as zero.
- **Unavailable (not zero)**: no data came back. `unavailable ≠ 0`: it means we don't know, not that you were never cited.

## Not AI-market share

Share of voice compares how often answers name you versus the competitors you track, inside your sampled prompts only. It isn't a measure of market share.

## What a check costs

One check uses one `ai_mentions_checks` unit per tracked prompt. Reading stored results, citations, and source gaps is free.

[Back to the docs index](./index.en.md)
