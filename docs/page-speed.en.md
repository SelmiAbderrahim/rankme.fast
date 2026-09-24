---
title: 'Page speed'
description: 'Core Web Vitals in plain words: real visitors vs a lab estimate.'
locale: en
slug: page-speed
section: audits
order: 1
---

# Page speed

Google grades pages on **Core Web Vitals**, three signals about how it feels to load and use a page. RankMeFast keeps field data (real visitors) and lab data (a test run) apart, and shows only what the configured provider actually returns.

## Real-visitor data (field data)
Google’s Chrome UX Report collects real visits from Chrome users. When your site has enough traffic, this is the number that matters, because it's what Google judges you on. The three signals:
- **LCP (Largest Contentful Paint):** how quickly the biggest visible element appears. Aim under 2.5 seconds.
- **INP (Interaction to Next Paint):** how quickly your page feels when you click or tap. Aim under 200 ms.
- **CLS (Cumulative Layout Shift):** how much things jump around during load. Aim under 0.1.

Field data appears only when Google CrUX is configured and has enough traffic for the URL or origin. The DataForSEO Lighthouse provider used in production only measures lab data, so this row stays empty. RankMeFast doesn't guess real-visitor numbers from a test run.

## Lab estimate (Lighthouse)
RankMeFast runs a simulated Lighthouse test in a controlled environment. In production this comes from DataForSEO Lighthouse Live. Treat it as a **hint**: a single Lighthouse run can vary by about 10 points from one attempt to the next. Don't chase small changes; look at the trend across audits.

## Mobile
Mobile is measured separately because phones render pages very differently. If your page is not mobile-friendly (missing viewport meta tag, tap targets too small), it lands in **Fix now**.

Tip: page-speed problems usually come down to images. Compress big images, serve modern formats (`webp` / `avif`), and lazy-load anything below the fold.

[Back to the docs index](./index.en.md)
