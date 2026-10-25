# Reverse proxy in front of the stack (split public/app hosts)

Operator-only. Applies when `CLIENT_URL` (public docs host) and `APP_URL`
(authenticated app host) are different origins and a host-level nginx
terminates TLS in front of the loopback-published `web` and `api` ports.

## Rules

1. **Never keep an app-route allow-list in the proxy.** The `web` container
   (`client/server.js`) already owns the host split: on the app host it
   serves the SPA shell for every path and 302s only the public surfaces
   (`/docs`, `/portal/:token`, `/share/:token`, with optional locale prefix)
   to `CLIENT_URL`; on the public host it 302s every non-public path to
   `APP_URL`. A proxy-side list of app prefixes drifts every time a route is
   added: `/exports`, `/actions`, `/dashboard/alerts` and friends were sent
   to the public host by a stale list, where the host-scoped session cookie
   is absent, so a refresh looked like a forced sign-out (issue #3).
   Symptom: an in-app link to a page works, but a refresh of the same page
   lands on the public host's sign-in with "Your session has expired", and
   `curl -sI https://<app host>/<that path>` answers `301` with a `Location`
   on the public host. Fixing the SPA or the `web` container cannot help; the
   proxy block itself must forward the path (see the reference below).
2. **Rate limits must answer 429, never 503.** nginx `limit_req` rejects with
   503 by default, and a 503 reads as "service down" instead of a back-off
   signal. Set `limit_req_status 429;` and size `burst` for the page-load
   fan-out. The api has its own per-account limiters. (Issue #4 was first
   blamed on this. It was not the cause: nginx logged those page-load reads
   as `499`, and the api logged "request aborted" a few milliseconds in,
   because the client itself had cancelled them.)
3. `/api/*` goes to the `api` port with the prefix preserved; everything else
   on either host goes to the `web` port with `Host` and `X-Forwarded-*`
   headers intact.
4. **Never add frame headers in the proxy.** The `web` and `api` containers
   already send exactly one `X-Frame-Options: DENY` and a CSP with
   `frame-ancestors 'none'` on every response (pinned by
   `client/src/web-server.test.ts` and
   `server/src/shared/middleware/security.test.ts`). A proxy
   `add_header X-Frame-Options ...` stacks a second, conflicting header that
   browsers treat as invalid. Do not set `X-Frame-Options`, a second
   `Content-Security-Policy`, or `proxy_hide_header` for them here.

## If a response carries two frame headers

A `curl -sI` that shows two `X-Frame-Options` lines (the application's `DENY`
followed by another value such as `SAMEORIGIN`) means the host nginx adds one.
The repository cannot remove it; the operator does:

1. Find the directive: `sudo grep -rn "X-Frame-Options" /etc/nginx/` (common
   places: an `ssl-params.conf` or `security-headers.conf` snippet, or a server
   block copied from a hardening guide).
2. Delete the `add_header X-Frame-Options ...` line for the RankMeFast server
   blocks, or stop including that snippet there. Keep the CSP the application
   sends.
3. `sudo nginx -t && sudo systemctl reload nginx`.
4. Verify each path type shows exactly one `x-frame-options: DENY` and
   `frame-ancestors 'none'`:

   ```bash
   for u in https://app.example.com/ https://app.example.com/dashboard \
            https://app.example.com/api/health https://docs.example.com/ \
            https://docs.example.com/robots.txt https://docs.example.com/docs; do
     echo "== $u"; curl -sI "$u" | grep -i 'x-frame-options\|frame-ancestors'
   done
   ```

## Reference nginx server blocks

Replace `docs.example.com`, `app.example.com`, and the loopback ports with the
values from your root `.env` (`WEB_PORT`, `API_PORT`). TLS directives are
omitted.

```nginx
upstream rankme_web { server 127.0.0.1:3000; keepalive 64; }
upstream rankme_api { server 127.0.0.1:48080; keepalive 64; }

limit_req_zone $binary_remote_addr zone=rankme_api_limit:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=rankme_auth_limit:10m rate=5r/s;

map $http_upgrade $rankme_connection_upgrade { default upgrade; '' close; }

# Shared by both server blocks via `include`.
# /etc/nginx/snippets/rankme-proxy.conf
#   limit_req_status 429;
#
#   location ^~ /api/auth {
#       limit_req zone=rankme_auth_limit burst=20 nodelay;
#       proxy_pass http://rankme_api;
#       proxy_http_version 1.1;
#       proxy_set_header Host $host;
#       proxy_set_header X-Real-IP $remote_addr;
#       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#       proxy_set_header X-Forwarded-Proto $scheme;
#       proxy_set_header Connection "";
#       proxy_buffering off;
#       proxy_read_timeout 120s;
#   }
#
#   location ^~ /api/ {
#       limit_req zone=rankme_api_limit burst=100 nodelay;
#       proxy_pass http://rankme_api;
#       proxy_http_version 1.1;
#       proxy_set_header Host $host;
#       proxy_set_header X-Real-IP $remote_addr;
#       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#       proxy_set_header X-Forwarded-Proto $scheme;
#       proxy_set_header Connection "";
#       proxy_buffering off;          # AI Assistant SSE stream
#       proxy_read_timeout 300s;
#   }
#
#   # Every other path: the web container decides (SPA shell, SSR docs, or
#   # a cross-host redirect). No per-route allow-list.
#   location / {
#       proxy_pass http://rankme_web;
#       proxy_http_version 1.1;
#       proxy_set_header Upgrade $http_upgrade;
#       proxy_set_header Connection $rankme_connection_upgrade;
#       proxy_set_header Host $host;
#       proxy_set_header X-Real-IP $remote_addr;
#       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#       proxy_set_header X-Forwarded-Proto $scheme;
#       proxy_set_header X-Forwarded-Host $host;
#   }

server {
    server_name docs.example.com;
    include /etc/nginx/snippets/rankme-proxy.conf;
}

server {
    server_name app.example.com;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location = /robots.txt {
        default_type text/plain;
        return 200 "User-agent: *\nDisallow: /\n";
    }
    include /etc/nginx/snippets/rankme-proxy.conf;
}
```

## Verify after a reload

```bash
# App routes stay on the app host (200, no Location header).
curl -sI https://app.example.com/exports | grep -iE '^(HTTP|location)'
# Public docs on the app host move to the public host (302 → CLIENT_URL).
curl -sI https://app.example.com/docs | grep -iE '^(HTTP|location)'
# A burst over the limit answers 429, not 503.
seq 200 | xargs -P50 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  https://app.example.com/api/health | sort | uniq -c
```
