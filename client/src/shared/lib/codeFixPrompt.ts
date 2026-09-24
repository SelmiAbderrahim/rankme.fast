const MAX_AFFECTED_URLS = 20;
const MAX_URL_LENGTH = 2_048;
const MAX_ANCHOR_TEXT_LENGTH = 500;

export interface CodeFixPromptSupportingFacts {
  sourceUrl?: string;
  targetUrl?: string;
  anchorText?: string;
}

export interface CodeFixPromptInput {
  reference: string;
  severity?: string;
  confidence?: string;
  problem: string;
  whyItMatters: string;
  recommendedFix: string;
  affectedUrls: string[];
  affectedUrlCount?: number;
  supportingFacts?: CodeFixPromptSupportingFacts;
}

export interface CodeFixPromptCopy {
  goal: string;
  untrustedContext: string;
  inspect: string;
  guardrails: string;
  abstain: string;
  report: string;
  siteWideScope: string;
  targetedScope: string;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function cleanSupportingFacts(
  facts: CodeFixPromptSupportingFacts | undefined,
): CodeFixPromptSupportingFacts | undefined {
  if (!facts) return undefined;

  const sourceUrl = safeHttpUrl(facts.sourceUrl);
  const targetUrl = safeHttpUrl(facts.targetUrl);
  const anchorText = facts.anchorText?.trim().slice(0, MAX_ANCHOR_TEXT_LENGTH);
  if (!sourceUrl && !targetUrl && !anchorText) return undefined;

  return {
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    ...(anchorText ? { anchorText } : {}),
  };
}

function totalAffectedUrls(input: CodeFixPromptInput): number {
  const supplied = input.affectedUrlCount;
  const normalized =
    supplied !== undefined && Number.isFinite(supplied)
      ? Math.max(0, Math.floor(supplied))
      : input.affectedUrls.length;
  return Math.max(normalized, input.affectedUrls.length);
}

export function buildCodeFixPrompt(input: CodeFixPromptInput, copy: CodeFixPromptCopy): string {
  const affectedUrls = input.affectedUrls
    .map((url) => safeHttpUrl(url))
    .filter((url): url is string => url !== undefined)
    .slice(0, MAX_AFFECTED_URLS);
  const affectedUrlCount = totalAffectedUrls(input);
  const supportingFacts = cleanSupportingFacts(input.supportingFacts);
  const context = {
    reference: input.reference,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
    problem: input.problem,
    whyItMatters: input.whyItMatters,
    recommendedFix: input.recommendedFix,
    scope: affectedUrlCount === 0 ? copy.siteWideScope : copy.targetedScope,
    affectedUrlCount,
    affectedUrls,
    omittedAffectedUrlCount: Math.max(0, affectedUrlCount - affectedUrls.length),
    ...(supportingFacts ? { supportingFacts } : {}),
  };

  return [
    copy.goal,
    '',
    copy.untrustedContext,
    '',
    'BEGIN_UNTRUSTED_FIX_CONTEXT',
    JSON.stringify(context, null, 2),
    'END_UNTRUSTED_FIX_CONTEXT',
    '',
    copy.inspect,
    '',
    copy.guardrails,
    '',
    copy.abstain,
    '',
    copy.report,
  ].join('\n');
}
