import type { DocsReader } from './src/features/docs/types';

export const DOC_LOCALES: readonly string[];
export const DOC_SECTIONS: readonly string[];

export class DocsContentError extends Error {}
export class DocsNotFoundError extends Error {}

export function createDocsReader(docsDir: string): DocsReader;
export function docsRoutePath(slug: string, locale: string): string;
export function explicitlyAcceptsMarkdown(accept?: string): boolean;
