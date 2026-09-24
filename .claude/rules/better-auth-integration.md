# Better Auth Integration — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Better Auth owns identity. The handler is mounted at `/api/auth/*` BEFORE `express.json()`. Never hand-roll auth, CSRF, or password hashing. Session access ALWAYS goes through `auth.api.getSession(fromNodeHeaders(req.headers))`. Every product route is protected by `[requireAuth, requireVerified]`. Cross-account isolation is tested and returns 404, not 403.**

## Why this rule exists

Sessions, scrypt hashing, CSRF (Origin / trusted-origins), cookie flags, email verification, password reset, and Google OAuth are vetted library code. Rolling any of them by hand is how the last four breaches happened. Passport + `jsonwebtoken` + `bcryptjs` are gone.

## Correct mount order

```typescript
// server/src/app.ts (excerpt)
app.use(requestId());
app.use(securityHeaders());
app.use(pinoHttp);
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(languageMiddleware());

// Polar webhook wants the raw Buffer — mount before express.json()
app.post("/api/billing/webhook", express.raw({ type: "*/*" }), webhookHandler);

// Better Auth's fetch-style handler wants the untouched body stream —
// mount BEFORE express.json().
app.all("/api/auth/*", createAuthRateLimiter(), toNodeHandler(auth));

// Only NOW parse JSON on the rest of the app.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Product routes behind auth + verified guard.
app.use("/api/sites", requireAuth, requireVerified, sitesRouter);
app.use("/api/audits", requireAuth, requireVerified, auditsRouter);
```

Mounting Better Auth AFTER `express.json()` consumes the body stream and breaks every request. Rate-limit BEFORE the handler so DoS attempts don't reach it.

## Session access

```typescript
// server/src/shared/middleware/require-auth.ts
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "@modules/auth/auth";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const session = await getAuth().api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) throw HttpError.unauthorized("common.unauthorized");
  req.user = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
  };
  next();
};
```

Every read of the current user goes through `req.user`. No direct DB lookup for identity, no JWT parsing, no cookie parsing by hand.

## Cross-account isolation — 404, not 403

Ownership check on every resource load. If the user is authenticated but does NOT own the resource, return **404**, not 403. Returning 403 leaks the existence of the resource.

```typescript
// CORRECT
const site = await Site.findOne({ _id: siteId, owner: req.user.id });
if (!site) throw HttpError.notFound("sites.notFound");

// FORBIDDEN — 403 leaks that the resource exists
const site = await Site.findById(siteId);
if (!site) throw HttpError.notFound("sites.notFound");
if (String(site.owner) !== req.user.id) throw HttpError.forbidden("sites.forbidden");
```

Test the cross-account path in every module — a different-account request MUST get 404.

## Client

```typescript
// client/src/features/auth/authClient.ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, ""),
});
export const { useSession: useAuthSession, signIn, signOut, signUp } = authClient;
```

- `useAuthSession()` is the ONLY source of auth state on the client. No Redux slice mirrors it.
- All `fetch` in `shared/api/client.ts` sends `credentials: 'include'`. Never attach `Authorization` headers.
- A 401 response raises a localized session-expired toast and clears the session.

## Migration + Mongo mirror

- Better Auth owns identity in Postgres; the Mongo `users` collection remains the domain profile store.
- `generateId` in the Better Auth config emits ObjectId-compatible hex; database hooks upsert a same-id mirror doc so `User.findById(req.user.id)` keeps working across every module.
- Role is a `user.additionalFields.role` (`input: false` — server-owned), default `Member`, mirrored to Mongo.
- Legacy users migrated by `server/src/scripts/migrate-users-to-better-auth.ts`; bcrypt hashes cannot be ported to scrypt, so migrated users reset their password via the standard reset flow.

## Env

- `BETTER_AUTH_SECRET` — required, ≥32 chars (`openssl rand -hex 32`).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — optional; the Google provider is registered only when BOTH are set. `accessType: offline` + consent prompt so a refresh token is available for GSC linking later.
- **Never** create a second OAuth client for GSC — reuse the auth client to avoid duplicate accounts.

## Forbidden

```typescript
// WRONG — hand-rolled JWT
import jwt from "jsonwebtoken";
const token = jwt.sign({ id }, process.env.JWT_SECRET);

// WRONG — bcrypt on the app
import bcrypt from "bcryptjs";
const hash = await bcrypt.hash(password, 12);

// WRONG — hand-rolled CSRF token
// (Better Auth's Origin / trusted-origins check already covers auth routes;
//  the double-submit CSRF middleware covers the rest.)

// WRONG — mounting Better Auth after express.json()
app.use(express.json());
app.all("/api/auth/*", toNodeHandler(auth));   // ← handler receives no body

// WRONG — reading the session from cookies directly
const token = req.cookies["better-auth.session_token"];   // never
```

## Validation Checklist

- [ ] Better Auth handler mounted BEFORE `express.json()`
- [ ] Every product route protected by `[requireAuth, requireVerified]`
- [ ] All session reads go through `req.user` (populated by `requireAuth`)
- [ ] No `jsonwebtoken`, no `bcryptjs`, no hand-rolled auth code
- [ ] Cross-account access returns 404, not 403 — tested per module
- [ ] Client uses `useAuthSession()`; no Redux auth slice
- [ ] `credentials: 'include'` on every fetch; no `Authorization` headers
