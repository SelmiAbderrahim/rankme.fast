# Pricing, marketing, and privacy review

This operator-only checklist governs the public facts in
`client/src/features/marketing/content/legal-authority.ts`. It is not served by
the marketing application.

## Release review

- Confirm the named subprocessors match the operator's active contracts and approved failover chain.
- Confirm Firecrawl receives selected public URLs and that raw HTML is discarded after sanitization.
- Confirm sanitized excerpts expire after seven days in every storage and cache path.
- Confirm AI briefs and drafts require the account's explicit opt-in before bounded excerpts leave RankMeFast.
- Confirm exports and account deletion cover Content Intelligence analyses, inventory runs, competitor runs, monitors, recommendation history, outcomes, and their Postgres event records.
- Confirm pricing, allowances, monitor limits, and credit packs still match the server tier catalog.
- Confirm the hosted Google Analytics configuration matches the public cookie wording and the operator's consent obligations.

## Counsel review items

- Review each AI provider's data-use and training terms before making any public no-training assurance.
- Review international-transfer mechanisms and the current subprocessor notice process.
- Review billing-record retention against the operator's tax jurisdiction.
- Review whether local law requires a separate cookie notice or consent mechanism for the deployed configuration.

Until counsel approves a stronger statement, public copy describes provider processing without promising that every provider contract forbids training.
