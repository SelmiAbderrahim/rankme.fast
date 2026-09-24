# DataForSEO App Data fixture provenance

These fixtures were authored on 2026-08-08 from the official DataForSEO App
Data and Labs response examples; no paid or live vendor request was made. Every
JSON body is passed through `run-redact-fixture.ts` before commit. `success.json`
is the Google Play contract default, while the explicit `success-google-play`
and `success-app-store` cases pin both store shapes.

Location note: App Data exposes store-specific location catalogs, but v1 only
passes numeric country-level location codes and defaults to United States
(`2840`) / English (`en`). Labs `app_intersection` currently supports only that
US/English pair; its adapter guard rejects every other pair before HTTP. This
fixture family intentionally does not introduce a location-catalog product.

`search-apps/not-ready.json` records the status shape observed on 2026-08-11
when `task_get` briefly returned `40402 Invalid Path` immediately after a valid
`task_post`; the accepted task appeared in `tasks_ready` four seconds later.
`search-apps/task-handed.json` records the `40601 Task Handed` shape retained
from a production App SEO keyword failure on the same date.
