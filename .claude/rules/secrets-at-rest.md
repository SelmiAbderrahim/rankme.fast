# Secrets at Rest — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every long-lived secret that enters the system via an OAuth flow, vendor callback, or user-supplied credential MUST be encrypted via the AES-256-GCM envelope in `shared/crypto/` BEFORE persistence. The plaintext MUST NOT persist in ANY store — Mongo, Postgres, Redis, or logs — beyond the minimum window needed to move it into the encrypted envelope.**

## Architecture

```
incoming secret (OAuth callback, vendor token, API key)
  │
  ├── encryptSecret(plaintext) → { ciphertext, iv, authTag, keyVersion }
  │     └── persisted in the owning module's store (Mongo / Postgres)
  │
  └── plaintext MUST be nullified at the source immediately after encryption
```

- The **envelope** (`EncryptedSecret` in `shared/crypto/index.ts`) is the single authoritative store.
- The master key (`MASTER_ENCRYPTION_KEY`) backs `keyRegistry.ts`; rotation re-encrypts envelopes, never touches plaintext.
- Better Auth's default `account` table stores OAuth tokens (refresh tokens, access tokens) in **plaintext text columns** — this is the framework default, NOT safe for production. Any module that reads a token from `account` MUST nullify the source column after moving the value into the envelope.

## Correct pattern

```typescript
// google-connections.service.ts — the canonical example
export async function upsertConnection(input: UpsertConnectionInput) {
  const encrypted = encryptSecret(input.refreshToken);  // envelope first
  const doc = await GoogleConnection.findOneAndUpdate(
    { accountId: input.accountId },
    { $set: { encryptedRefreshToken: encrypted } },
    { upsert: true, new: true },
  );
  // THEN nullify the plaintext source — the envelope is now authoritative.
  await clearPlaintextRefreshToken(input.accountId);
  return doc;
}
```

## FORBIDDEN

```typescript
// WRONG — plaintext stays in the account row indefinitely
const row = await db.select().from(account).where(eq(account.userId, id));
await GoogleConnection.create({ refreshToken: row[0].refreshToken });
// account.refresh_token is never cleared → a DB dump leaks a live token

// WRONG — storing plaintext in Mongo
await GoogleConnection.create({ refreshToken: plaintextToken });

// WRONG — logging the token before encrypting
logger.info({ refreshToken: input.refreshToken }, 'connect');
```

## Scope

| Secret | Source | Encrypted store | Plaintext to clear |
|--------|--------|-----------------|-------------------|
| GSC refresh token | Better Auth `account.refresh_token` | `GoogleConnection.encryptedRefreshToken` (Mongo) | `account.refresh_token` (Postgres) |
| Future OAuth tokens | Better Auth `account.*` | Module-specific envelope | `account.*Token` columns |
| User-supplied API keys | `POST /api/api-keys` | `api_keys.keyHash` (sha256 — no envelope needed, input is random) | N/A (never stored plaintext) |
| Operator Firecrawl keys | root `.env` | root `.env` only; never duplicated into Mongo/Postgres/Redis | N/A |

For cross-account vendor resources, persistence may contain a domain-separated
SHA-256 credential reference solely to find the configured operator key that
owns the resource. The reference is not authentication material, is never a
substitute for the root `.env`, and must remain absent from public DTOs and logs.
Never persist the raw or separately encrypted Firecrawl API key per resource.

## Validation Checklist

- [ ] Every `encryptSecret()` call is followed by nullification of the plaintext source
- [ ] No `account.refreshToken` / `account.accessToken` plaintext persists after the module copies it into an envelope
- [ ] No plaintext token appears in a `logger.info()` / `logger.warn()` / `logger.error()` call
- [ ] The `redactedLogger` child logger is used in any module that touches token fields
- [ ] A test asserts the plaintext column is `null` after the connect/upsert flow completes
- [ ] Master-key rotation (`shared/crypto/rotate.ts`) re-encrypts envelopes; no plaintext path exists that bypasses the envelope
