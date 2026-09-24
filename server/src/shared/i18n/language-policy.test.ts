import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasTranslationKey } from './errors.js';
import { DICTIONARIES, verifyKeyParity } from './index.js';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const SERVER_ROOT = path.join(REPOSITORY_ROOT, 'server', 'src');
const CLIENT_ROOT = path.join(REPOSITORY_ROOT, 'client', 'src');
const CLIENT_LOCALE_ROOT = path.join(CLIENT_ROOT, 'shared', 'i18n', 'locales');
const LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;
const HTTP_ERROR_FACTORIES = new Set([
  'badRequest',
  'unauthorized',
  'forbidden',
  'notFound',
  'conflict',
  'tooMany',
  'internal',
]);

interface ExactExclusion {
  path: string;
  reason: string;
}

const EXACT_EXCLUSIONS = {
  httpErrorDescriptor: [
    {
      path: 'shared/utils/http-error.ts',
      reason: 'This is the typed HttpError factory implementation, not a response producer.',
    },
  ],
  directJsonLiteral: [
    {
      path: 'modules/auth/auth.ts',
      reason: 'Better Auth owns this narrow compatibility response family and maps its public errors.',
    },
  ],
  rawFetchContext: [
    {
      path: 'shared/api/client.ts',
      reason: 'This is the canonical fetch choke point that creates the shared context headers.',
    },
  ],
  clientApiEnvironment: [
    {
      path: 'shared/api/client.ts',
      reason: 'The shared API transport is the canonical API-origin resolver.',
    },
    {
      path: 'features/auth/authClient.ts',
      reason: 'Better Auth requires its own origin while reusing the shared URL normalizer.',
    },
    {
      path: 'shared/navigation/appHref.ts',
      reason: 'Shared navigation resolves the configured browser origin, not an API endpoint.',
    },
  ],
  languageHeaderLiteral: [
    {
      path: 'shared/api/client.ts',
      reason: 'The canonical transport defines and exports the one language-header constant.',
    },
  ],
} satisfies Record<string, readonly ExactExclusion[]>;

function productionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionFiles(target));
    } else if (
      /\.tsx?$/u.test(entry.name) &&
      !/\.(?:test|spec)\.tsx?$/u.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(target);
    }
  }
  return files.sort();
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isExcluded(
  kind: keyof typeof EXACT_EXCLUSIONS,
  relativePath: string,
): boolean {
  return EXACT_EXCLUSIONS[kind].some((entry) => entry.path === relativePath);
}

function englishTemplate(key: string): string | undefined {
  let cursor: unknown = DICTIONARIES.en;
  for (const segment of key.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function scanServerSource(relativePath: string, contents: string): string[] {
  const failures: string[] = [];
  const source = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const requestSchema =
    /(?:^|\/)[^/]+(?:\.api)?\.schemas?\.ts$/u.test(relativePath) ||
    relativePath === 'shared/security/input-guards.ts';
  if (
    !requestSchema &&
    !/(?:HttpError|\.json\s*\(|\b(?:translate|semanticCopy|localizeSemanticCopy)\s*\()/u.test(
      contents,
    )
  ) {
    return failures;
  }

  const visit = (node: ts.Node): void => {
    let descriptor: ts.Expression | undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'HttpError' &&
      HTTP_ERROR_FACTORIES.has(node.expression.name.text)
    ) {
      descriptor = node.arguments[0];
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'HttpError'
    ) {
      descriptor = node.arguments?.[1];
    }

    if (descriptor && !isExcluded('httpErrorDescriptor', relativePath)) {
      if (!ts.isObjectLiteralExpression(descriptor)) {
        failures.push(`${relativePath}:${lineOf(source, node)} HttpError needs an inline descriptor`);
      } else {
        const properties = new Map(
          descriptor.properties
            .filter(ts.isPropertyAssignment)
            .map((property) => [propertyName(property.name), property.initializer]),
        );
        for (const required of ['code', 'messageKey']) {
          if (!properties.has(required)) {
            failures.push(`${relativePath}:${lineOf(source, node)} HttpError is missing ${required}`);
          }
        }
        const key = properties.get('messageKey');
        if (key && ts.isStringLiteral(key)) {
          if (!hasTranslationKey(key.text)) {
            failures.push(`${relativePath}:${lineOf(source, key)} unknown HttpError key ${key.text}`);
          }
          if (englishTemplate(key.text)?.includes('{{') && !properties.has('vars')) {
            failures.push(`${relativePath}:${lineOf(source, key)} placeholder key needs safe vars`);
          }
        }
      }
    }

    if (requestSchema) {
      if (
        ts.isPropertyAssignment(node) &&
        propertyName(node.name) === 'message' &&
        ts.isStringLiteral(node.initializer) &&
        !hasTranslationKey(node.initializer.text)
      ) {
        failures.push(`${relativePath}:${lineOf(source, node)} literal Zod message`);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        new Set(['regex', 'min', 'max', 'refine']).has(node.expression.name.text)
      ) {
        const customMessage = node.arguments[1];
        if (
          customMessage &&
          ts.isStringLiteral(customMessage) &&
          !hasTranslationKey(customMessage.text)
        ) {
          failures.push(`${relativePath}:${lineOf(source, customMessage)} literal Zod message`);
        }
      }
    }

    if (
      !isExcluded('directJsonLiteral', relativePath) &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json'
    ) {
      const body = node.arguments[0];
      if (body && ts.isObjectLiteralExpression(body)) {
        for (const property of body.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyName(property.name);
          if (
            (name === 'message' || name === 'error') &&
            (ts.isStringLiteral(property.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(property.initializer))
          ) {
            failures.push(`${relativePath}:${lineOf(source, property)} authored JSON ${name} literal`);
          }
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        new Set(['translate', 'semanticCopy', 'localizeSemanticCopy']).has(node.expression.text)
      ) {
        const keyIndex = node.expression.text === 'translate' || node.expression.text === 'localizeSemanticCopy' ? 1 : 0;
        const key = node.arguments[keyIndex];
        if (key && ts.isStringLiteral(key) && !hasTranslationKey(key.text)) {
          failures.push(`${relativePath}:${lineOf(source, key)} unresolved server key ${key.text}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return failures;
}

interface ClientResourceIndex {
  qualified: Map<string, string>;
  unqualified: Map<string, string[]>;
}

function clientEnglishResources(): ClientResourceIndex {
  const qualified = new Map<string, string>();
  const unqualified = new Map<string, string[]>();
  const directory = path.join(CLIENT_LOCALE_ROOT, 'en');
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
    const namespace = filename.slice(0, -'.json'.length);
    const value = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8')) as unknown;
    const walk = (node: unknown, prefix = ''): void => {
      if (typeof node === 'string') {
        qualified.set(`${namespace}:${prefix}`, node);
        unqualified.set(prefix, [...(unqualified.get(prefix) ?? []), node]);
        const plural = /^(.*)_(?:zero|one|two|few|many|other)$/u.exec(prefix)?.[1];
        if (plural) unqualified.set(plural, [...(unqualified.get(plural) ?? []), node]);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${name}` : name);
      }
    };
    walk(value);
  }
  return { qualified, unqualified };
}

function resolveClientTemplates(key: string, resources: ClientResourceIndex): string[] {
  if (key.includes(':')) {
    const exact = resources.qualified.get(key);
    return exact === undefined ? [] : [exact];
  }
  return resources.unqualified.get(key) ?? [];
}

function scanClientSource(
  relativePath: string,
  contents: string,
  resources: ClientResourceIndex,
): string[] {
  const failures: string[] = [];
  const source = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  if (!isExcluded('languageHeaderLiteral', relativePath) && /['"]x-lang['"]/u.test(contents)) {
    failures.push(`${relativePath}: raw x-lang literal outside the shared transport`);
  }
  if (
    !isExcluded('clientApiEnvironment', relativePath) &&
    /import\.meta\.env\.VITE_(?:API_BASE_URL|APP_URL)/u.test(contents)
  ) {
    failures.push(`${relativePath}: feature-level API origin construction`);
  }
  if (!/(?:\bfetch\s*\(|(?:\.|\b)t\s*\()/u.test(contents)) return failures;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'fetch' &&
      !isExcluded('rawFetchContext', relativePath) &&
      !contents.includes('apiContextHeaders')
    ) {
      failures.push(`${relativePath}:${lineOf(source, node)} raw fetch bypasses context headers`);
    }

    if (ts.isCallExpression(node)) {
      const isTranslationCall =
        (ts.isIdentifier(node.expression) && node.expression.text === 't') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't');
      const key = node.arguments[0];
      if (isTranslationCall && key && ts.isStringLiteral(key)) {
        const templates = resolveClientTemplates(key.text, resources);
        if (templates.length === 0) {
          failures.push(`${relativePath}:${lineOf(source, key)} unresolved client key ${key.text}`);
        } else if (templates.every((template) => template.includes('{{')) && !node.arguments[1]) {
          failures.push(`${relativePath}:${lineOf(source, key)} placeholder key has no variables`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return failures;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .sort();
}

function clientLocaleEntries(locale: (typeof LOCALES)[number]): Map<string, string> {
  const entries = new Map<string, string>();
  const directory = path.join(CLIENT_LOCALE_ROOT, locale);
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
    const namespace = filename.slice(0, -'.json'.length);
    const value = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8')) as unknown;
    const walk = (node: unknown, prefix = ''): void => {
      if (typeof node === 'string') {
        entries.set(`${namespace}:${prefix}`, node);
      } else if (node && typeof node === 'object') {
        for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
          walk(child, prefix ? `${prefix}.${name}` : name);
        }
      }
    };
    walk(value);
  }
  return entries;
}

describe('repository language policy', () => {
  it('keeps every exact exclusion narrow, documented, and present', () => {
    const all = Object.entries(EXACT_EXCLUSIONS).flatMap(([kind, entries]) =>
      entries.map((entry) => ({ kind, ...entry })),
    );
    expect(all.every((entry) => entry.reason.length >= 24)).toBe(true);
    expect(new Set(all.map((entry) => `${entry.kind}:${entry.path}`)).size).toBe(all.length);
    for (const entry of all) {
      const root = entry.kind === 'rawFetchContext' || entry.kind === 'clientApiEnvironment' || entry.kind === 'languageHeaderLiteral'
        ? CLIENT_ROOT
        : SERVER_ROOT;
      expect(fs.existsSync(path.join(root, entry.path)), entry.path).toBe(true);
    }
  });

  it('rejects user-facing server literals and unresolved descriptor keys/placeholders', () => {
    const failures = productionFiles(SERVER_ROOT).flatMap((file) =>
      scanServerSource(path.relative(SERVER_ROOT, file), fs.readFileSync(file, 'utf8')),
    );
    expect(failures).toEqual([]);
  });

  it('guards shared client language headers, API origins, fetch context, and literal keys', () => {
    const resources = clientEnglishResources();
    const failures = productionFiles(CLIENT_ROOT).flatMap((file) =>
      scanClientSource(path.relative(CLIENT_ROOT, file), fs.readFileSync(file, 'utf8'), resources),
    );
    expect(failures).toEqual([]);
  });

  it('keeps all server and client keys and placeholders aligned across exactly seven locales', () => {
    expect(verifyKeyParity()).toEqual({ ok: true });
    const english = clientLocaleEntries('en');
    expect(LOCALES).toEqual(['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']);
    for (const locale of LOCALES) {
      const current = clientLocaleEntries(locale);
      expect([...current.keys()].sort(), `${locale} client keys`).toEqual([...english.keys()].sort());
      for (const [key, template] of english) {
        expect(placeholders(current.get(key) ?? ''), `${locale}:${key}`).toEqual(placeholders(template));
      }
    }
  });

  it('proves each detector fails closed without classifying logs, protocols, source data, or fixtures', () => {
    expect(scanServerSource('modules/example/example.controller.ts', "throw HttpError.badRequest('English');")).not.toEqual([]);
    expect(scanServerSource('modules/example/example.schema.ts', "z.string().min(1, 'Required');")).not.toEqual([]);
    expect(scanServerSource('modules/example/example.controller.ts', "res.json({ error: 'Nope' });")).not.toEqual([]);
    const resources = clientEnglishResources();
    expect(scanClientSource('features/example/api.ts', "fetch('/api/example');", resources)).not.toEqual([]);
    expect(scanClientSource('features/example/api.ts', "const h = 'x-lang';", resources)).not.toEqual([]);
    expect(scanClientSource('features/example/api.ts', "const u = import.meta.env.VITE_API_BASE_URL;", resources)).not.toEqual([]);
    expect(scanClientSource('features/example/View.tsx', "t('missing.key');", resources)).not.toEqual([]);
  });
});
