import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './single-flight.js';

describe('createSingleFlight', () => {
  it('two concurrent callers on the same key share one task run', async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const task = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'value';
    };
    const [a, b] = await Promise.all([flight.run('k', task), flight.run('k', task)]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(calls).toBe(1);
  });

  it('releases the key after the task settles — next run executes again', async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const task = async () => {
      calls += 1;
      return calls;
    };
    await flight.run('k', task);
    await flight.run('k', task);
    expect(calls).toBe(2);
  });

  it('propagates a task error to every concurrent caller and releases the key', async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error('vendor exploded');
    };
    const [a, b] = await Promise.allSettled([flight.run('k', failing), flight.run('k', failing)]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(calls).toBe(1);
    // Key released — a later run executes the task again.
    await expect(flight.run('k', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('runs distinct keys independently', async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const task = async () => {
      calls += 1;
      return calls;
    };
    await Promise.all([flight.run('a', task), flight.run('b', task)]);
    expect(calls).toBe(2);
  });
});
