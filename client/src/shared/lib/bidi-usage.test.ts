/** Visible user and third-party text must preserve its own direction. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Data properties that hold user or third-party text. */
export const USER_PROPERTIES = new Set([
  'phrase', 'phrases', 'keyword', 'domain', 'targetDomain', 'displayName', 'prompt', 'query',
  'title', 'url', 'displayUrl', 'name', 'label', 'email', 'hostname',
  // Third-party and generated text: Search Console rows, SERP questions,
  // snippets and headings, crawled URLs, AI output, store listings.
  'key', 'question', 'snippet', 'heading', 'term', 'sourceUrl', 'targetUrl', 'host', 'competitor',
  'text', 'description',
]);
/** Variables named for user text (not `label`/`name`/`title`, which are mostly interface copy). */
export const USER_IDENTIFIERS = new Set([
  'phrase', 'keyword', 'domain', 'targetDomain', 'displayName', 'prompt', 'query', 'url', 'email', 'hostname',
  'topic', 'term', 'chip',
]);
/** Helpers that return a site, page or row name. */
export const USER_HELPERS = new Set([
  'siteName', 'siteOptionLabel', 'siteLabel', 'pagesRowName', 'pagesPathLabel',
  'rowLabel', 'reportName', 'profileLabel',
]);
const TEXT_ATTRIBUTES = new Set(['title', 'placeholder', 'alt']);

/**
 * The initializer of the nearest enclosing `const`/`let` with this name, so
 * `const name = siteLabel(row)` makes a later `{name}` user text in
 * that scope, whatever the variable is called.
 */
const localInitializer = (id: ts.Identifier): ts.Expression | undefined => {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === id.text) return declaration.initializer;
      }
    }
  }
  return undefined;
};

const userText = (expression: ts.Expression, depth = 0): string | null => {
  let e = expression;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isPropertyAccessExpression(e) && USER_PROPERTIES.has(e.name.text)) return e.getText();
  if (ts.isIdentifier(e) && USER_IDENTIFIERS.has(e.text)) return e.text;
  if (ts.isIdentifier(e) && depth < 3) {
    const initializer = localInitializer(e);
    if (initializer && userText(initializer, depth + 1)) return e.text;
  }
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText().split('.').pop()!;
    if (USER_HELPERS.has(callee)) return e.getText();
  }
  // A fallback chain (`a ?? b`, `a || b`) shows the user text on its left.
  if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return userText(e.left, depth);
  }
  if (ts.isConditionalExpression(e)) return userText(e.whenTrue, depth) ?? userText(e.whenFalse, depth);
  return null;
};

const isIsolateCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && node.expression.getText() === 'isolateText';

const insideIsolation = (node: ts.Node): boolean => {
  for (let current = node.parent; current; current = current.parent) {
    if (isIsolateCall(current)) return true;
    if (ts.isJsxElement(current)) {
      const opening = current.openingElement;
      const tag = opening.tagName.getText();
      if (tag === 'Bdi' || tag === 'bdi') return true;
      if (opening.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'dir')) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Crawler-facing metadata: `<Seo>` props (the `<title>`, meta description,
 * Open Graph and Twitter tags) and JSON-LD built with `schema.*`. Search
 * results and social cards show these strings outside the page, where
 * isolation marks would surface as stray characters, so they stay plain and
 * are exempt from the checks below.
 */
const insideMetadata = (node: ts.Node, jsonLdBuilder: boolean): boolean => {
  for (let current = node.parent; current; current = current.parent) {
    if (
      jsonLdBuilder &&
      ts.isCallExpression(current) &&
      /^schema\.\w+$/.test(current.expression.getText())
    ) {
      return true;
    }
    if (ts.isJsxAttribute(current)) return current.parent.parent.tagName.getText() === 'Seo';
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return false;
  }
  return false;
};

const attributeName = (node: ts.Node): string | null => {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return current.name.getText();
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return null;
  }
  return null;
};

const isToastCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && /^toast(\.\w+)?$/.test(node.expression.getText());

const insideToast = (node: ts.Node): boolean => {
  for (let current = node.parent; current; current = current.parent) {
    if (isToastCall(current)) return true;
    if (ts.isJsxElement(current) || ts.isFunctionLike(current)) return false;
  }
  return false;
};

const isTranslateCall = (node: ts.CallExpression): boolean =>
  /^(t|i18n\.t)$/.test(node.expression.getText());

/** True when the file imports the JSON-LD builders (`schema` from `@shared/seo`), not a zod `schema`. */
const importsJsonLdBuilders = (source: ts.SourceFile): boolean =>
  source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@shared/seo' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === 'schema'),
  );

export function findUnisolated(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const jsonLdBuilder = importsJsonLdBuilders(source);
  const metadata = (node: ts.Node) => insideMetadata(node, jsonLdBuilder);
  const misses: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    misses.push(`${fileName}:${line} ${what}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && ['Bdi', 'bdi'].includes(node.openingElement.tagName.getText())) {
      for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (!ts.isJsxElement(parent)) continue;
        const tag = parent.openingElement.tagName.getText();
        if (tag === 'foreignObject') break;
        if (tag === 'svg') {
          report(node, 'SVG text needs plain-text isolation, not HTML Bdi');
          break;
        }
      }
    }
    // 1. A JSX child.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const found = userText(node.expression);
      if (found && !insideIsolation(node)) report(node, `child {${found}} needs <Bdi>`);
    }
    // Native text attributes also need isolation for a direct value, not only
    // template literals. Table cells forward title to the native element;
    // content components such as RecordCard isolate their own title prop.
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText()) &&
      (/^[a-z]/u.test(node.parent.parent.tagName.getText()) ||
        ['TableCell', 'TableHead'].includes(node.parent.parent.tagName.getText())) && node.initializer &&
      ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const value = node.initializer.expression;
      const found = userText(value);
      if (found && !isIsolateCall(value)) report(node, `text attribute ${found} needs isolateText`);
    }
    // 2. A translation interpolation value (not inside a native or forwarded accessible name).
    if (
      ts.isCallExpression(node) &&
      isTranslateCall(node) &&
      !(attributeName(node)?.startsWith('aria-') || attributeName(node) === 'ariaLabel') &&
      !metadata(node)
    ) {
      const values = node.arguments[1];
      if (values && ts.isObjectLiteralExpression(values)) {
        for (const property of values.properties) {
          const value = ts.isPropertyAssignment(property)
            ? property.initializer
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : null;
          if (!value || isIsolateCall(value)) continue;
          const found = userText(value);
          if (found) report(property, `t() value ${found} needs isolateText`);
        }
      }
    }
    // 3. A template literal in a text attribute or a toast (not a translation
    //    key such as t(`filters.${filter.key}`), which is never shown).
    const isTranslationKey =
      ts.isTemplateExpression(node) &&
      ts.isCallExpression(node.parent) &&
      isTranslateCall(node.parent) &&
      node.parent.arguments[0] === node;
    if (ts.isTemplateExpression(node) && !isTranslationKey && !metadata(node)) {
      const attribute = attributeName(node);
      if ((attribute && TEXT_ATTRIBUTES.has(attribute)) || insideToast(node)) {
        for (const span of node.templateSpans) {
          if (isIsolateCall(span.expression)) continue;
          const found = userText(span.expression);
          if (found) report(span, `\${${found}} needs isolateText`);
        }
      }
    }
    // 4. A toast message that is user text itself.
    if (ts.isCallExpression(node) && isToastCall(node)) {
      const first = node.arguments[0];
      if (first && !isIsolateCall(first) && userText(first)) report(first, 'toast text needs isolateText');
    }
    // 5. Isolation marks in crawler-facing metadata.
    if (isIsolateCall(node) && metadata(node)) report(node, 'metadata must stay plain: drop isolateText');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return misses;
}

const components = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'ui' && dir.endsWith('shared') ? [] : components(path);
    return path.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(path) ? [path] : [];
  });

describe('user content preserves its direction', () => {
  it('catches shared chip text and direct native tooltip values', () => {
    expect(findUnisolated('chips.tsx', '<span>{chip}</span>')).toHaveLength(1);
    expect(findUnisolated('title.tsx', '<button title={row.phrase} />')).toHaveLength(1);
    expect(findUnisolated('cell.tsx', '<TableCell title={row.keyword} />')).toHaveLength(1);
    expect(findUnisolated('safe.tsx', '<button title={isolateText(row.phrase)}><Bdi>{chip}</Bdi></button>')).toEqual([]);
    expect(findUnisolated('owner.tsx', '<RecordCard title={row.phrase} />')).toEqual([]);
  });

  it('flags each unisolated pattern and accepts the isolated forms', () => {
    const bad = `
      const A = ({ k, site }) => (<td>{k.phrase}</td>);
      const B = () => <p>{t('delete', { domain: site.domain })}</p>;
      const C = () => <button title={\`Open \${site.domain}\`} />;
      const D = () => toast(site.domain);
      const E = () => <span>{siteName(site)}</span>;
      const F = () => t('x', { keyword });
    `;
    expect(findUnisolated('bad.tsx', bad)).toHaveLength(6);
    const good = `
      const A = ({ k, site }) => (<td><Bdi>{k.phrase}</Bdi></td>);
      const B = () => <p>{t('delete', { domain: isolateText(site.domain) })}</p>;
      const C = () => <button title={\`Open \${isolateText(site.domain)}\`} aria-label={t('open', { domain: site.domain })} />;
      const D = () => toast(isolateText(site.domain));
      const E = () => <span dir="auto">{siteName(site)}</span>;
      const F = () => <a href={\`/x/\${site.domain}\`} key={k.name}>{t('open')}</a>;
      const G = () => <input placeholder={t(\`filters.\${filter.key}\`)} />;
    `;
    expect(findUnisolated('good.tsx', good)).toEqual([]);
  });

  it('treats a local variable holding user text as user text', () => {
    const bad = `
      const A = ({ row }) => { const name = siteLabel(row); return <h3>{name}</h3>; };
      const B = ({ site }) => { const heading = site?.displayName || site?.domain; return <p>{heading}</p>; };
    `;
    expect(findUnisolated('locals.tsx', bad)).toEqual([
      'locals.tsx:2 child {name} needs <Bdi>',
      'locals.tsx:3 child {heading} needs <Bdi>',
    ]);
    const good = `
      const A = ({ row }) => { const name = siteLabel(row); return <h3><Bdi>{name}</Bdi></h3>; };
      const B = () => { const name = t('menu.title'); return <h3>{name}</h3>; };
    `;
    expect(findUnisolated('locals.tsx', good)).toEqual([]);
  });

  it('follows `||` fallbacks to the user text on their left', () => {
    const bad = `
      const A = ({ page }) => <h2>{page.title || page.displayUrl || t('untitled')}</h2>;
      const B = ({ chat }) => <p>{t('delete', { title: chat?.title || t('untitled') })}</p>;
      const C = ({ user }) => <span>{user?.name || user?.email}</span>;
    `;
    expect(findUnisolated('fallback.tsx', bad)).toEqual([
      'fallback.tsx:2 child {page.title} needs <Bdi>',
      'fallback.tsx:3 t() value chat?.title needs isolateText',
      'fallback.tsx:4 child {user?.name} needs <Bdi>',
    ]);
    const good = `
      const A = ({ page }) => <h2><Bdi>{page.title || page.displayUrl || t('untitled')}</Bdi></h2>;
      const B = ({ chat }) => <p>{t('delete', { title: isolateText(chat?.title || t('untitled')) })}</p>;
      const C = ({ open, closed }) => <span>{open || closed}</span>;
    `;
    expect(findUnisolated('fallback.tsx', good)).toEqual([]);
  });

  it('keeps crawler-facing metadata plain: <Seo> props and @shared/seo JSON-LD', () => {
    const plain = `
      import { Seo, schema } from '@shared/seo';
      const ld = schema.breadcrumbList([{ name: t('vs.title', { name: competitor.name }), path: '/' }]);
      const A = () => (
        <Seo
          title={\`\${guide.title} \${t('suffix')}\`}
          description={t('vs.seoDescription', { name: competitor.name })}
          jsonLd={ld}
        />
      );
    `;
    expect(findUnisolated('meta.tsx', plain)).toEqual([]);
    const marked = `
      import { Seo, schema } from '@shared/seo';
      const ld = schema.breadcrumbList([{ name: isolateText(competitor.name), path: '/' }]);
      const A = () => <Seo title={t('vs.seoTitle', { name: isolateText(competitor.name) })} />;
    `;
    expect(findUnisolated('meta.tsx', marked)).toEqual([
      'meta.tsx:3 metadata must stay plain: drop isolateText',
      'meta.tsx:4 metadata must stay plain: drop isolateText',
    ]);
    // Visible copy keeps its checks; a zod \`schema\` call is not JSON-LD.
    const visible = `
      import { schema } from './schema';
      const A = () => <h1 title={\`\${guide.title}\`}>{t('vs.title', { name: competitor.name })}</h1>;
      const B = () => schema.parse(t('x', { name: competitor.name }));
    `;
    expect(findUnisolated('visible.tsx', visible)).toEqual([
      'visible.tsx:3 ${guide.title} needs isolateText',
      'visible.tsx:3 t() value competitor.name needs isolateText',
      'visible.tsx:4 t() value competitor.name needs isolateText',
    ]);
  });

  it('keeps option names logical and uses text isolation in SVG content', () => {
    expect(findUnisolated('options.tsx', '<select><option dir="auto">{row.name}</option></select>')).toEqual([]);
    expect(findUnisolated('options.tsx', '<select><option>{row.name}</option></select>')).toHaveLength(1);
    expect(findUnisolated('chart.tsx', '<svg><text>{isolateText(row.name)}</text></svg>')).toEqual([]);
    expect(findUnisolated('chart.tsx', '<svg><text><Bdi>{row.name}</Bdi></text></svg>')).toEqual([
      'chart.tsx:1 SVG text needs plain-text isolation, not HTML Bdi',
    ]);
  });

  it('every component isolates user content', () => {
    const files = components(SRC);
    expect(files).toContain(join(SRC, 'shared/components/PositionDelta.tsx'));
    expect(files).toContain(join(SRC, 'features/ranks/components/KeywordsPanel.tsx'));
    const misses = files.flatMap((file) =>
      findUnisolated(relative(SRC, file), readFileSync(file, 'utf8')),
    );
    expect(misses).toEqual([]);
  });
});
