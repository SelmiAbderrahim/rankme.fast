# SSRF URL Safety — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every server-side fetch of a URL influenced by a user, crawl, redirect, webhook, SERP result, or third party MUST use `assertPublicUrlSafe` / `fetchPublicUrlSafe` from `server/src/shared/security/url-safety.ts`. No other module may implement private-address checks.**

The authority parses with WHATWG `URL`, rejects encoded hosts and credentials, resolves every A/AAAA record, blocks private/reserved/metadata ranges, pins the validated address for the connection, revalidates every redirect, strips ambient credentials, and enforces deadline/redirect/response ceilings. HTTP is disabled unless operator/test code explicitly passes `allowHttp: true`.

## Correct

```typescript
const response = await fetchPublicUrlSafe(candidateUrl, { method: 'GET' });
```

```typescript
const normalized = await assertPublicUrlSafe(webhook.callbackUrl);
```

## Forbidden

```typescript
await fetch(req.body.url);                 // raw untrusted fetch
if (!url.includes('127.0.0.1')) fetch(url); // ad-hoc check misses DNS/IPv6
dns.lookup(host); fetch(url);               // validation/connect DNS race
```

## Validation Checklist

- [ ] Every untrusted outbound URL imports the shared authority
- [ ] No feature/provider has a private-IP, metadata-host, or redirect safety reimplementation
- [ ] Redirects use `manual` mode and are checked per hop
- [ ] Tests inject DNS/clock/transport; no live vendor or internet call
- [ ] `rg "fetch\\(" server/src --glob "!shared/security/**" --glob "!shared/providers/http.ts" --glob "!**/*.test.ts"` contains first-party/internal or fixed vendor-origin calls only
