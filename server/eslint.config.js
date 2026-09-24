import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const providerHttpRestriction = {
  group: ['**/shared/providers/http', '**/shared/providers/http.js'],
  message:
    'Modules must not import vendor HTTP clients directly. Receive providers via shared/providers/registry (see shared/providers/index.ts).',
};
const mcpRestriction = {
  group: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*'],
  message: '@modelcontextprotocol/sdk is confined to src/modules/mcp/.',
};
const aiRestriction = {
  group: ['ai', 'ai/*', '@ai-sdk/*'],
  message: 'AI SDK imports are confined to src/shared/providers/.',
};
const firecrawlRestriction = {
  group: ['@mendable/firecrawl-js', '@mendable/firecrawl-js/*', 'firecrawl', 'firecrawl/*'],
  message: 'Firecrawl clients are confined to src/shared/providers/firecrawl/.',
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'coverage-*',
      'coverage-current',
      'coverage.nobody.*',
      '**/coverage/**',
      '.vitest-cache',
      '*.cjs',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
  {
    // Feature modules receive providers through the registry. MCP is the one
    // protocol-infrastructure exception for its SDK, not for vendor clients.
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [providerHttpRestriction, mcpRestriction, aiRestriction, firecrawlRestriction] },
      ],
    },
  },
  {
    files: ['src/modules/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [providerHttpRestriction, aiRestriction, firecrawlRestriction] },
      ],
    },
  },
  {
    files: ['src/shared/providers/**/*.ts'],
    ignores: ['src/shared/providers/firecrawl/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [mcpRestriction, firecrawlRestriction] },
      ],
    },
  },
  {
    files: ['src/shared/providers/firecrawl/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [mcpRestriction] }],
    },
  },
  {
    // The composition root must import the confined adapter it selects; the
    // restriction still blocks Firecrawl SDK/client imports everywhere else.
    files: ['src/shared/providers/registry.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [mcpRestriction] }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/modules/**/*.ts', 'src/shared/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [mcpRestriction, aiRestriction, firecrawlRestriction] },
      ],
    },
  },
  prettier,
);
