/**
 * Client mirror of the server's `trackedPromptKey`
 * (`ai-visibility.repository.ts` in the server module): two prompts
 * are the same when they differ only in case, punctuation, symbols or spacing.
 */
export function trackedPromptKey(prompt: string): string {
  return prompt
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
