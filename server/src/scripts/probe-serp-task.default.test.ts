import { describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() =>
  vi.fn(async () => [{ status: 'created', taskId: null, costUsd: null }]),
);

vi.mock('../shared/providers/http.js', () => ({
  dataForSeoRequest: request,
}));

import { probeSerpTask } from './probe-serp-task.js';

describe('SERP task probe default request adapter', () => {
  it('uses the shared provider request when no test seam is supplied', async () => {
    const result = await probeSerpTask(
      {
        cfg: {
          baseUrl: 'https://api.example.test/v3',
          login: 'login',
          password: 'password',
        },
        now: () => 0,
        wait: async () => undefined,
      },
      { keyword: 'probe' },
    );

    expect(request).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ errorClass: 'NoTaskId', outcome: 'error' });
  });
});
