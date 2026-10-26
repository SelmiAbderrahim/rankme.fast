/**
 * Which finished streams count as a cut-off reply.
 */
import { describe, expect, it } from 'vitest';
import { finishedStatus } from './chat.controller.js';
import type { ChatMessagePartDto } from './chat.schema.js';

const text = (value: string): ChatMessagePartDto => ({ type: 'text', text: value });
const toolResult: ChatMessagePartDto = {
  type: 'tool_result',
  toolCallId: 'c1',
  toolName: 'list_keywords',
  ok: true,
  structuredContent: {},
};

describe('finishedStatus', () => {
  it('is complete when the model stopped after a written answer', () => {
    expect(finishedStatus('stop', [toolResult, text('All keywords held.')])).toBe('complete');
  });

  it.each(['length', 'error'])('is incomplete when the finish reason is %s', (reason) => {
    expect(finishedStatus(reason, [text('✅ No issue —')])).toBe('incomplete');
  });

  it('is incomplete when nothing answered the user after the last tool result', () => {
    expect(finishedStatus('tool_calls', [text('Checking…'), toolResult])).toBe('incomplete');
    expect(finishedStatus('stop', [text('   ')])).toBe('incomplete');
    expect(finishedStatus('stop', [])).toBe('incomplete');
  });
});
