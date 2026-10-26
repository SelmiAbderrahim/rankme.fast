import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('deployable nginx routing (issue #3)', () => {
  it('forwards every app path to the web router with the original host and URI', () => {
    const config = fs.readFileSync(path.join(root, 'ops/nginx/rankme-proxy.conf'), 'utf8');
    const web = config.match(/location \/ \{([^}]+)\}/)?.[1];
    expect(web).toContain('proxy_pass http://rankme_web;');
    expect(web).toContain('proxy_set_header Host $host;');
    expect(web).toContain('proxy_set_header X-Forwarded-Host $host;');
    expect(config).not.toMatch(/\b(?:return|rewrite)\b/);
    expect(config).not.toContain('/exports');
  });

  it('preserves the API prefix and lets the application own security headers', () => {
    const config = fs.readFileSync(path.join(root, 'ops/nginx/rankme-proxy.conf'), 'utf8');
    expect(config).toMatch(/location \^~ \/api\/ \{[^}]*proxy_pass http:\/\/rankme_api;/);
    expect(config).toContain('limit_req_status 429;');
    expect(config).not.toMatch(/add_header\s+(?:X-Frame-Options|Content-Security-Policy)/i);
  });
});
