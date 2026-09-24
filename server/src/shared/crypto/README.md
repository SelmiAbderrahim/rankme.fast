# Secrets at Rest & Master-Key Rotation

The `shared/crypto` module encrypts sensitive values at rest so they never sit
plaintext in Mongo — Polar API tokens, Google Search Console refresh tokens,
and anything else routed through `encryptSecret`.

## Algorithm

- **AES-256-GCM** via Node's `node:crypto` stdlib. No home-rolled crypto.
- **12-byte random IV** per encryption (`crypto.randomBytes(12)`).
- **16-byte GCM auth tag** captured on encrypt, verified on decrypt.
- **32-byte key** derived from `env.MASTER_ENCRYPTION_KEY` (hex, base64, or
  utf8 — first encoding that yields ≥ 32 bytes wins; only the first 32 bytes
  are used).

Any tampering — flipped ciphertext byte, swapped IV, mangled auth tag,
wrong-key decrypt — causes `decryptSecret` to **throw**. No silent partial
plaintext, ever.

## Record Shape

```ts
interface EncryptedSecret {
  ciphertext: string;   // base64
  iv: string;           // base64, 12 bytes
  authTag: string;      // base64, 16 bytes
  keyVersion: number;   // integer, matches the key registry
}
```

The shape is frozen. Downstream modules (billing, google-connections) embed it verbatim as
a Mongoose sub-schema and pull the TypeScript type via `InferSchemaType`.

## Startup Gate

`server/src/config/env.ts` runs a zod refinement over `MASTER_ENCRYPTION_KEY`:
missing or < 32 decoded bytes → schema parse fails → the process exits at
import time before any route mounts. There is no in-memory fallback secret;
there is no way to boot without a valid key.

## No-Leak Discipline

- The 32-byte key lives only in a private in-memory `Map<version, Buffer>`.
- The module never `console.log`s, never `logger.*`s a plaintext or a key.
- `decryptSecret` is called only at the moment of use; decrypted values are
  never returned to a client, never serialized to a response body, never
  written to a persistent log.

## Master-Key Rotation Runbook

Rotation exists so a compromised master key can be replaced without downtime
and without re-issuing every Polar credential / GSC refresh token that was encrypted
under the old key.

### Step 1 — Add the new key at the next version

Introduce `MASTER_ENCRYPTION_KEY_V2` (or higher) alongside the current
`MASTER_ENCRYPTION_KEY`. Extend the key registry so both versions are
resolvable — the old key stays available for decrypt, the new key is stamped
onto every fresh `encryptSecret` call once `currentKeyVersion` advances.

### Step 2 — Advance `currentKeyVersion`

Once `getCurrentKeyVersion()` returns the new version, every new record is
written at the new version. Existing records are still readable at the old
version because the registry keeps both.

### Step 3 — Re-encrypt existing records (decrypt-old → re-encrypt-new)

Iterate the collections that embed `EncryptedSecret` (billing, google-connections) and,
for each document, call `reEncryptSecret(record, newVersion)` and **atomically
swap** the sub-document. Atomic swap means a single `updateOne` that replaces
the entire encrypted record — never leave a document with a mismatched
`keyVersion` and a stale IV / ciphertext.

Pseudocode:

```ts
for (const doc of docsWithLegacyRecord) {
  const migrated = reEncryptSecret(doc.encrypted, newVersion);
  await Collection.updateOne(
    { _id: doc._id, 'encrypted.keyVersion': doc.encrypted.keyVersion },
    { $set: { encrypted: migrated } },
  );
}
```

The `keyVersion` filter is the concurrency guard — a second worker that
already migrated the row will be a no-op instead of double-migrating.

### Step 4 — Retire the old key

Once no records remain at the old version (verified by a count query),
retire the old key from the registry and remove the env var.

## Losing the Key = Unrecoverable (by default)

By default there is no escrow, no KMS backdoor, no recovery service. If
`MASTER_ENCRYPTION_KEY` is lost, every encrypted record in Mongo becomes
permanently unrecoverable. Back the key up out-of-band before deploying to
production — a password manager, an offline HSM, or split shares across the
operator team.

### Opt-in recovery-code escrow

A user may **explicitly opt in** to recovery-code escrow
(`modules/recovery/recovery-codes.ts`). When enabled:

1. A random 32-byte escrow key wraps the current master key (AES-256-GCM); the
   wrapped key is stored on the user document (`recoveryEscrow.wrappedKey`).
2. The escrow key is split into N recovery codes via **Shamir secret sharing**
   (GF(256)) with threshold M. The codes are shown to the user **once** and are
   **never stored**.
3. Recovery (`recoverMasterKeyBytes`) reconstructs the escrow key from any ≥ M
   codes and unwraps the master key, which then feeds the rotation runbook.

The default posture is unchanged for anyone who does not opt in — no wrapped key
is stored. **Threat-model delta:** for a user who opts in, an attacker who
obtains the database **and** ≥ M of that user's recovery codes can recover the
master key. Recovery codes must therefore be guarded as carefully as the master
key itself.

## What This Module Does NOT Do

- **No KMS/HSM integration.** The key is a raw 32-byte value in process
  memory. A future prompt may add an envelope-encryption layer.
- **No per-record DEKs.** One master key encrypts every record at a given
  version. Envelope encryption with per-record data keys is out of scope.
- **No rotation scheduler.** The runbook above is a manual operator flow.
  Automation lands in a later prompt.
