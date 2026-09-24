import type { RequestHandler } from 'express';
import helmet from 'helmet';
// Helmet with defaults tightened for a JSON API + SSR marketing surface.
// The API serves JSON, Better Auth, and the static /docs handler — no inline
// scripts — so a strict Content-Security-Policy applies cleanly here. The web
// (SSR) container sets its own CSP with a per-request nonce for its inline
// theme-bootstrap + ssr-init scripts (see client/server.js). `style-src`
// allows inline styles (React style props); tightening to hashes is a
// follow-up. `font-src 'self'` is coherent — the accent font is self-hosted.
export const securityHeaders: RequestHandler = helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
});
