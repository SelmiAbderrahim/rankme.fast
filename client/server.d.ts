// Type declarations for the plain-ESM web/SSR entrypoint `server.js`.
// TypeScript resolves `import ... from './server.js'` to this sibling file, so
// tests (e.g. src/web-server.test.ts) type-check without a `@ts-nocheck`.
import type { Server } from 'node:http';

export interface CreateServerOptions {
  listen?: boolean;
  port?: number;
  host?: string;
  production?: boolean;
  template?: string;
  renderFn?: (url: string, requestContext?: unknown) => Promise<unknown>;
  apiOrigin?: string;
  proxyTimeoutMs?: number;
  proxySchemaGenerationTimeoutMs?: number;
  proxyStreamTimeoutMs?: number;
  registerSignals?: boolean;
  exitOnSigterm?: boolean;
  compressionEnabled?: boolean;
  serverFactory?: unknown;
  docsDir?: string;
}

export interface WebServer {
  app: import('express').Express;
  server: Server | null;
  close: () => Promise<void>;
}

export function createServer(opts?: CreateServerOptions): Promise<WebServer>;
export function __clearSsrCacheForTests(): void;
