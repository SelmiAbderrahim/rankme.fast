// Deleted — the account helper's tests live under vitest (jsdom) in
// src/features/marketing/marketing.render.test.tsx and its siblings.
// Keeping this file present would cause vitest to import Playwright-only
// modules from `./account.ts` in a Node context. The Playwright suites do
// not need vitest coverage.
export {};
