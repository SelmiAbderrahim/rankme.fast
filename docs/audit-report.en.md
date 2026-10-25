---
title: 'Reading your audit report'
description: 'What Fix now, Watch and Passed mean, and what each rule checks.'
locale: en
slug: audit-report
section: start
order: 2
---

# Reading your audit report

After each audit you land on a report with three tabs and a **Retest** button. It's written for site owners rather than SEO specialists, and any technical term comes with a plain explanation.

## The three tabs
- **Fix now**: problems Google reacts to fastest. Each row is either critical or a broken signal you can act on today.
- **Watch**: smaller issues, or checks we couldn't score because there wasn't enough data. Worth keeping an eye on, but rarely urgent.
- **Passed**: checks your site cleared. A quick look now and then is a useful sanity check.

## What each issue shows
- **Title**: a plain name for the problem.
- **Why it matters**: one sentence on why Google or your visitors care.
- **Affected URLs**: the pages where we found it, so you can go straight there.
- **How to fix it**: the change to make. **Copy fix** puts it on your clipboard.

## Retest and change badges
Once you've shipped a fix, click **Retest**. The new audit is compared with the previous one, and a row can get one of two badges:
- **Fixed**: a rule that used to fail on that URL now passes.
- **Regressed**: a rule now fails on a URL where it passed before. New failures count as regressions too.

The comparison uses a frozen snapshot of your previous audit, so an older report keeps showing the same results.

## `llms.txt`
`/llms.txt` is a newer convention: a plain-text file that points AI assistants (ChatGPT, Perplexity, Claude and others) to the pages you'd like them to read and cite. RankMeFast treats this rule as **advisory**. We suggest adding one, but nothing is broken without it.

## Every rule in plain words
- **Blocked from Google**: A `robots.txt` rule is telling Google to stay away. If the page should rank, remove the disallow line.
- **Sitemap missing or weak**: A sitemap is a file at `/sitemap.xml` that lists your pages. Add one and reference it from `robots.txt`.
- **Page titles missing or weak**: The `<title>` is the headline people see in Google results. Give every page a specific title of 30–60 characters.
- **Meta descriptions missing or duplicated**: The short snippet Google shows below the title. Write a different one for each page.
- **Page headings missing or overused**: Use one `<h1>` per page, then `<h2>` and `<h3>` for structure. A missing `<h1>` matters a lot; two `<h1>`s matter less.
- **Canonical link missing or broken**: A `<link rel="canonical">` tells Google which URL is the main version of a page. It causes problems when it is missing or points to another site.
- **Structured data missing or broken**: Machine-readable tags (JSON-LD) that help Google understand articles, products and FAQs.
- **Broken internal links**: Links from one of your pages to another that return an error. Fix or remove them.
- **Thin content**: Pages with fewer than about 200 words look empty to Google. Expand the ones you want to rank.
- **No FAQ signals found**: We found no question-and-answer sections. FAQs help both visitors and AI assistants.
- **llms.txt file missing (advisory)**: A newer convention: a `/llms.txt` file that points AI crawlers to your best content. It is optional, so this rule is advisory only.
- **HTTPS not enforced**: Your site should redirect http to https and use the https version as the canonical URL.
- **Poor real-visitor performance**: Real visitors had a slow experience on the page. The data comes from Google’s Chrome UX Report, and sites with little traffic may not have any yet.
- **Low lab performance estimate**: Our Lighthouse test run scored low. Scores vary by about 10 points between runs, so use this as a hint.
- **Not mobile-friendly**: The page doesn’t display well on phones. Check tap-target sizes and the viewport meta tag.
- **Not indexed by Google**: Google looked at the page but didn’t add it to search results. If this rule can’t get data, reconnect Google Search Console.
- **Rich results issues**: Google recognised your structured data but found errors that keep the page from showing enhanced results.
- **Indexed with warnings**: The page is indexed, but Google flagged a canonical or duplicate-content problem.
- **Pages that answer with an error**: Crawled addresses that returned an error (4xx or 5xx). Bring the page back or redirect the address. Addresses that refused our crawler (401, 403 or 429) may be bot protection, so check them in a browser first.
- **Redirect chains and loops**: Addresses that take two or more redirects to reach a page, or never reach one. Point the first address straight at the final page.
- **Links that point to redirects**: Internal links whose target redirects. Link to the final address instead.
- **Pages that redirect with a refresh tag**: A `<meta http-equiv="refresh">` tag sends visitors on. Use a permanent (301) server redirect instead.
- **Canonical tags that point to the wrong place**: A canonical that points to a broken page, a redirect, another canonical, or back and forth between two pages. Point it at a working page that names itself.
- **Pages no other page links to**: Pages listed in your sitemap that no internal link reaches. Link to them from a related page or menu.
- **Pages buried deep in the site**: Pages more than three clicks from the home page. Bring the important ones closer.
- **Pages that share a title**: Two or more pages with the same `<title>`. Give each page its own.
- **Pages that look like copies of each other**: Pages the crawler judged near-identical, with a similarity score out of ten. Merge them or make each one distinct.
- **Placeholder text on live pages**: "Lorem ipsum" filler text on a published page. Replace it with the real copy.
- **Secure pages linking to insecure addresses**: HTTPS pages that link to `http://` addresses. Switch them to `https://`.
- **Images without alt text**: Images with no `alt` attribute. Describe meaningful images and give decorative ones an empty `alt`.
- **Pages slow to start loading**: The crawler waited more than 1.5 seconds for the first byte, or more than three seconds for the page. One lab load from our crawler, not every visitor's experience.
- **Very large pages**: HTML over 1 MB. Over 3 MB the finding moves to Fix now.
- **Pages sent without compression**: HTML sent without gzip or Brotli compression. Turn compression on at the server.
- **Scripts and styles that delay the first view**: Files that block the first paint, with how many. Load scripts with `async` or `defer`.
- **Pages missing basic HTML declarations**: No `<!DOCTYPE html>` line or no character-set declaration.
- **Outdated HTML on your pages**: Removed tags, Flash or frames. Frames such as embedded videos can be fine, so check them rather than remove them.
- **Addresses that are hard to read**: Addresses with unusual characters, query parameters, or more than 120 characters.
- **Pages without social sharing tags**: No Open Graph tags, so a shared link may show the wrong title, text or image.
- **No favicon**: No small site icon for browser tabs and search results.
- **Broken images, scripts or styles**: Files a page needs that answer with an error. This check runs only on an audit started with the resource scan; otherwise the report lists it under Not evaluated.
- **Images that are larger than needed**: Images over 500 KB. Runs with the full resource scan, like the check above.
- **Files browsers are told not to keep**: Images, scripts and stylesheets sent with headers that stop browsers from caching them. Runs with the full resource scan.

## Scanning images, scripts and styles

The last three checks need every image, script and stylesheet on your pages to be loaded. That makes the crawl slower and uses more of your crawl budget, so each audit has its own option for it.

- **Scan images, scripts and styles** is ticked by default when you start an audit. Untick it to skip the scan for that run.
- A scanned audit crawls at most 1,000 pages. Untick the option to crawl more pages, without the scan.
- If the scan can't be read, the audit still finishes and the three checks appear under Not evaluated with the reason.
- An audit that ran without the scan lists these checks under Not evaluated. Start a new audit with the option ticked to include them.

[Back to the docs index](./index.en.md)
