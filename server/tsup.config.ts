import { defineConfig } from 'tsup';

export default defineConfig({
  // Two deployables from one package: dist/server.cjs (api) and
  // dist/worker.cjs (queue consumers). Same image, different command.
  entry: ['src/server.ts', 'src/worker.ts'],
  define: {
    'process.env.APP_BUILD_SHA': JSON.stringify(
      /^[a-f0-9]{7,12}$/iu.test(process.env.APP_BUILD_SHA ?? '')
        ? process.env.APP_BUILD_SHA!.toLowerCase()
        : 'dev',
    ),
  },
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  minify: false,
});
