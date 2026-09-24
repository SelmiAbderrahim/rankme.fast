# Feature Modules — Strict Rule

## MANDATORY REQUIREMENT

**Feature modules are the unit of organization. Cross-feature imports are FORBIDDEN except via `shared/` or the target module's `index.ts` public API.**

## Structure

```
client/src/
├── features/
│   ├── auth/                # Better Auth React client + screens
│   │   ├── components/
│   │   ├── store/           # slice.ts, thunks.ts, selectors.ts (RTK)
│   │   ├── api.ts           # thin apiClient<T>() wrappers
│   │   ├── types.ts
│   │   ├── routes.tsx       # route array spread into app/routes.tsx
│   │   └── index.ts         # named re-exports (public API)
│   ├── sites/
│   ├── ranks/
│   ├── report/
│   ├── keyword-research/
│   ├── backlinks/
│   ├── competitors/
│   ├── google/
│   ├── billing/
│   ├── marketing/
│   ├── dashboard/
│   └── admin/
├── shared/
│   ├── api/client.ts        # apiClient<T>, ApiError, credentials: 'include'
│   ├── hooks/redux.ts       # typed useAppSelector / useAppDispatch
│   ├── i18n/                # 7-locale resources
│   ├── lib/utils.ts         # cn() (shadcn)
│   ├── seo/                 # JSON-LD builders, hreflang helpers
│   ├── theme/               # .dark class + ThemeProvider
│   └── ui/                  # shadcn primitives (vendored)
└── styles/tailwind.css

server/src/
├── modules/
│   ├── auth/                # Better Auth instance + verified gate
│   ├── users/
│   ├── sites/
│   ├── audits/              # audit pipeline + rule engine
│   ├── audit/               # append-only audit log
│   ├── ranks/
│   ├── keyword-research/
│   ├── backlinks/
│   ├── competitors/
│   ├── google-connections/
│   ├── billing/             # Polar + webhook + entitlements
│   ├── communication/       # Resend mailer
│   ├── legal/               # data-rights (export + delete)
│   ├── health/
│   └── seo/                 # /robots.txt, /sitemap*.xml
├── shared/
│   ├── billing/             # assertCapacity + tier catalog
│   ├── crypto/              # AES-256-GCM envelope
│   ├── i18n/
│   ├── middleware/
│   ├── providers/           # vendor capability interfaces + registry + fixtures
│   ├── queue/               # BullMQ connection + queue names
│   ├── testing/             # mongo.ts, postgres.ts, redis.ts
│   ├── types/               # express.d.ts augmentations
│   ├── utils/               # http-error, async-handler
│   └── validation/          # shared zod schemas
├── db/                      # Drizzle schema/*, migrations, counters
├── app.ts
├── server.ts                # api entrypoint
└── worker.ts                # worker entrypoint
```

## Import Rules

### CORRECT

```typescript
// Importing from a feature's public API
import { LoginForm, useAuthSession } from "@features/auth";

// Importing a shared utility
import { apiClient } from "@shared/api/client";

// Feature importing its own internal files
import { validateEmail } from "./validators";
```

### FORBIDDEN

```typescript
// Reaching into another feature's internals
import { LoginForm } from "@features/auth/components/LoginForm";

// Importing a sibling feature's reducer directly
import { authReducer } from "@features/auth/store/slice";

// Server module reaching into another server module
import { auditRunModel } from "../audits/audits.model";
```

## Module Public API (`index.ts`)

Each module's `index.ts` is its public interface. It re-exports the components, hooks, actions, and functions that other modules are allowed to consume.

```typescript
// client/src/features/auth/index.ts
export { LoginForm, SignupForm } from "./components";
export { login, logout, signup } from "./store/thunks";
export { authReducer } from "./store/slice";
export { useAuthSession } from "./authClient";
```

```typescript
// server/src/modules/sites/index.ts
export { sitesRouter } from "./sites.routes";
export { Site, type SiteDocument } from "./sites.model";
export { validateSiteUrl } from "./sites.service";
```

## When to Create a New Module

Create a new feature module when:
- It has its own data model (Mongoose schema, Drizzle table, or Redux state slice)
- It has 3+ components or route handlers
- It represents a distinct user-facing feature

Do NOT create a module for:
- A single utility function (put in `shared/utils/`)
- A single shared component (put in `shared/ui/` or `shared/components/`)
- A one-off page that reuses existing modules

## Vendor SDK boundary

Vendor SDKs / HTTP clients may ONLY be imported by `server/src/shared/providers/**`. The ESLint `no-restricted-imports` rule scoped to `src/modules/**` blocks imports of DataForSEO, Anthropic, Google APIs, Polar, Resend, etc. from feature code. Modules import the capability interface (`RankProvider`, `KeywordProvider`, …) and get the concrete adapter from the registry.
→ See `provider-interfaces.md`.

## Validation Checklist

- [ ] No direct imports from another feature's internal files
- [ ] Each module has an `index.ts` public API
- [ ] Shared code lives in `shared/`, not duplicated across features
- [ ] Vendor SDKs stay inside `server/src/shared/providers/`
- [ ] New features follow the established module structure
