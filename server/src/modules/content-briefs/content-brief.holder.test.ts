import { afterEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import {
  getContentBriefAi,
  getContentBriefDb,
  getContentBriefQueue,
  setContentBriefAi,
  setContentBriefDb,
  setContentBriefQueue,
} from './content-brief.holder.js';

afterEach(() => {
  setContentBriefDb(null);
  setContentBriefQueue(null);
  setContentBriefAi(null);
});

describe('content-brief holders', () => {
  it('fails loudly without a db and exposes nullable queue/default AI order', () => {
    expect(() => getContentBriefDb()).toThrow('content-brief db not configured');
    expect(getContentBriefQueue()).toBeNull();
    expect(getContentBriefAi()).toEqual({ runner: null, providerOrder: ['fake'] });
  });

  it('round-trips injected dependencies', () => {
    const db = {} as never;
    const queue = {} as Queue;
    const runner = { preflight() {}, async run() { return {} as never; } } as AiProfileRunner;
    setContentBriefDb(db);
    setContentBriefQueue(queue);
    setContentBriefAi(runner, ['openai']);
    expect(getContentBriefDb()).toBe(db);
    expect(getContentBriefQueue()).toBe(queue);
    expect(getContentBriefAi()).toEqual({ runner, providerOrder: ['openai'] });
  });
});
