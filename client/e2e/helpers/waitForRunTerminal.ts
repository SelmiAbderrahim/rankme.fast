/**
 * Bounded status-polling helper.
 *
 * Later journey specs need to await queued work — audits, ranks,
 * AI visibility runs, audience research runs, content analyses — driven by
 * BullMQ consumers on the compose `worker`. Waiting for a wall-clock
 * interval is banned; instead this helper polls the shipped public status
 * endpoint and resolves only when the response reports one of the semantic
 * terminal states declared by the spec.
 *
 * It uses Playwright's `APIRequestContext` so it participates in the same
 * cookie jar/CSRF flow as the browser under test, never a raw `fetch`. No
 * production route is added — the endpoints are the same ones a customer
 * would poll.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';

export interface PollDiagnostic {
  attempts: number;
  elapsedMs: number;
  lastStatus?: string;
  lastHttpStatus?: number;
  responseBody?: unknown;
}

export interface WaitForRunTerminalOptions {
  /** Absolute deadline in wall-clock ms. Required — no default; each caller decides. */
  deadlineMs: number;
  /** Minimum ms between polls. Default 500 (fast enough for fake-provider terminal in <5s). */
  intervalMs?: number;
  /** Optional label included in the timeout error, e.g. `audit ${runId}`. */
  label?: string;
}

export interface TerminalResult<TBody = unknown> {
  status: string;
  httpStatus: number;
  body: TBody;
  diagnostic: PollDiagnostic;
}

const DEFAULT_INTERVAL_MS = 500;

/** Semantic terminal states shared across the four run families. */
export const AUDIT_TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled'];
export const RANK_TERMINAL: readonly string[] = ['confirmed', 'volatile', 'unconfirmed', 'failed'];
export const AI_VISIBILITY_TERMINAL: readonly string[] = ['completed', 'partial', 'failed', 'cancelled'];
export const AUDIENCE_RESEARCH_TERMINAL: readonly string[] = ['completed', 'refunded', 'failed', 'cancelled'];
export const CONTENT_ANALYSIS_TERMINAL: readonly string[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

interface PollInput {
  request: APIRequestContext;
  url: string;
  terminal: readonly string[];
  options: WaitForRunTerminalOptions;
  /** Extract the semantic status string from a 2xx JSON body. */
  extractStatus?: (body: unknown) => string | undefined;
}

async function safeJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function defaultExtractStatus(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object' && 'status' in body) {
    const value = (body as { status: unknown }).status;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

async function pollUntilTerminal(input: PollInput): Promise<TerminalResult> {
  const { request, url, terminal, options } = input;
  const extract = input.extractStatus ?? defaultExtractStatus;
  const interval = Math.max(50, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const start = Date.now();
  let attempts = 0;
  let lastStatus: string | undefined;
  let lastHttpStatus: number | undefined;
  let lastBody: unknown = null;
  while (Date.now() - start <= options.deadlineMs) {
    attempts += 1;
    const response = await request.get(url);
    lastHttpStatus = response.status();
    lastBody = await safeJson(response);
    if (response.ok()) {
      lastStatus = extract(lastBody);
      if (lastStatus !== undefined && terminal.includes(lastStatus)) {
        return {
          status: lastStatus,
          httpStatus: lastHttpStatus,
          body: lastBody,
          diagnostic: {
            attempts,
            elapsedMs: Date.now() - start,
            lastStatus,
            lastHttpStatus,
            responseBody: lastBody,
          },
        };
      }
    }
    const remaining = options.deadlineMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
  }
  const label = options.label ?? url;
  const diagnostic: PollDiagnostic = {
    attempts,
    elapsedMs: Date.now() - start,
    lastStatus,
    lastHttpStatus,
    responseBody: lastBody,
  };
  throw new Error(
    `waitForRunTerminal(${label}) exceeded ${options.deadlineMs}ms; ` +
      `attempts=${attempts} lastHttp=${lastHttpStatus ?? 'n/a'} lastStatus=${lastStatus ?? 'n/a'}`,
  );
}

export interface RunLocator {
  request: APIRequestContext;
  runId: string;
  options: WaitForRunTerminalOptions;
}

export function waitForAuditTerminal(input: RunLocator): Promise<TerminalResult> {
  return pollUntilTerminal({
    request: input.request,
    url: `/api/audits/${encodeURIComponent(input.runId)}`,
    terminal: AUDIT_TERMINAL,
    options: input.options,
  });
}

export function waitForRankTerminal(input: RunLocator): Promise<TerminalResult> {
  return pollUntilTerminal({
    request: input.request,
    url: `/api/ranks/${encodeURIComponent(input.runId)}`,
    terminal: RANK_TERMINAL,
    options: input.options,
  });
}

export function waitForAiVisibilityTerminal(input: RunLocator): Promise<TerminalResult> {
  return pollUntilTerminal({
    request: input.request,
    url: `/api/ai-visibility/runs/${encodeURIComponent(input.runId)}`,
    terminal: AI_VISIBILITY_TERMINAL,
    options: input.options,
  });
}

export function waitForAudienceResearchTerminal(input: RunLocator): Promise<TerminalResult> {
  return pollUntilTerminal({
    request: input.request,
    url: `/api/audience-research/runs/${encodeURIComponent(input.runId)}`,
    terminal: AUDIENCE_RESEARCH_TERMINAL,
    options: input.options,
  });
}

export function waitForContentAnalysisTerminal(input: RunLocator): Promise<TerminalResult> {
  return pollUntilTerminal({
    request: input.request,
    url: `/api/content-analyses/${encodeURIComponent(input.runId)}`,
    terminal: CONTENT_ANALYSIS_TERMINAL,
    options: input.options,
  });
}

/**
 * Escape hatch for custom endpoints. Direct callers must still declare their
 * own terminal-state set — no wildcard "any 2xx" success.
 */
export function waitForRunTerminal<TBody = unknown>(input: {
  request: APIRequestContext;
  url: string;
  terminal: readonly string[];
  extractStatus?: (body: unknown) => string | undefined;
  options: WaitForRunTerminalOptions;
}): Promise<TerminalResult<TBody>> {
  return pollUntilTerminal({
    request: input.request,
    url: input.url,
    terminal: input.terminal,
    options: input.options,
    extractStatus: input.extractStatus,
  }) as Promise<TerminalResult<TBody>>;
}
