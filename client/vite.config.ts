import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_LOCALE_LOADER = fileURLToPath(
  new URL('./src/shared/i18n/localeLoader.server.ts', import.meta.url),
);

function loadRootClientEnv(mode: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const path = resolve(PROJECT_ROOT, filename);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      if (key.startsWith('VITE_') && value !== undefined) result[key] = value;
    }
  }
  return result;
}

function analyticsHtmlPlugin(rawMeasurementId: string): Plugin {
  const candidate = rawMeasurementId.trim();
  const measurementId = /^G-[A-Z0-9]+$/u.test(candidate) ? candidate : '';
  return {
    name: 'rankme-analytics-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('__RANKME_GA_ID__', JSON.stringify(measurementId)),
    },
  };
}

function manualChunk(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  if (
    normalized.includes('/src/features/team/') ||
    normalized.includes('/src/features/workspace/')
  ) {
    return 'workspace-team';
  }
  if (normalized.includes('/src/features/marketing/')) {
    return 'marketing-core';
  }
  if (normalized.includes('/src/shared/i18n/locales/en/')) {
    return /\/(?:docs|guides|marketing)\.json$/u.test(normalized)
      ? 'locale-en-marketing'
      : 'locale-en-app';
  }
  if (
    /\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//u.test(normalized)
  ) {
    return 'react-vendor';
  }
  if (
    /\/node_modules\/(?:@radix-ui|lucide-react|radix-ui|sonner)\//u.test(normalized)
  ) {
    return 'ui';
  }
  if (
    /\/node_modules\/(?:@reduxjs\/toolkit|i18next|i18next-browser-languagedetector|i18next-resources-to-backend|react-i18next|react-redux)\//u.test(
      normalized,
    )
  ) {
    return 'data';
  }
  if (
    /\/node_modules\/(?:@better-auth|better-auth|better-call|qrcode)\//u.test(normalized)
  ) {
    return 'auth-vendor';
  }
  return undefined;
}

export default defineConfig(({ isSsrBuild, mode }) => {
  const rootEnv = loadRootClientEnv(mode);
  for (const [key, value] of Object.entries(rootEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const serverProxyTarget = process.env.SERVER_URL ?? 'http://localhost:8080';
  const measurementId = process.env.VITE_GA_ID ?? rootEnv.VITE_GA_ID ?? '';
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const rawSha = process.env.APP_BUILD_SHA ?? 'dev';
  const buildSha = /^[a-f0-9]{7,12}$/iu.test(rawSha) ? rawSha.toLowerCase() : 'dev';

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(`${version}+${buildSha}`),
    },
    plugins: [analyticsHtmlPlugin(measurementId), react(), tailwindcss(), tsconfigPaths()],
    resolve: {
      alias: isSsrBuild
        ? [{ find: '@shared/i18n/localeLoader', replacement: SERVER_LOCALE_LOADER }]
        : [],
    },
    ssr: {
      // react-helmet-async ships CommonJS; bundle it into the SSR output so
      // Node's ESM loader doesn't choke on its named exports.
      noExternal: ['react-helmet-async'],
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/api': {
          target: serverProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      // No source maps in the shipped bundle. `'hidden'` still EMITS the `.map`
      // files (it only drops the sourceMappingURL comment), and the prod web
      // container serves the whole `dist/` via sirv — so `GET /assets/<hash>.js.map`
      // would hand an attacker the original TypeScript. `false` emits none.
      sourcemap: false,
      ...(!isSsrBuild
        ? {
            rollupOptions: {
              output: {
                manualChunks: manualChunk,
              },
            },
          }
        : {}),
    },
  };
});
