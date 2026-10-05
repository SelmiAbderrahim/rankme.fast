import { describe, expect, it, vi } from 'vitest';
import { retainAuthSession, SESSION_FOCUS_MIN_INTERVAL_MS } from './sessionKeepAlive';

const setup = (visibilityState: 'visible' | 'hidden' = 'visible') => {
  let clock = 1_000;
  const unlisten = vi.fn();
  const listen = vi.fn(() => unlisten);
  const notify = vi.fn();
  const handlers: Array<() => void> = [];
  const doc = {
    visibilityState,
    addEventListener: vi.fn((_: string, fn: () => void) => { handlers.push(fn); }),
    removeEventListener: vi.fn(),
  };
  const client = { $store: { atoms: { session: { listen } }, notify } };
  const dispose = retainAuthSession({
    client: client as never,
    doc: doc as never,
    now: () => clock,
  });
  return {
    advance: (ms: number) => { clock += ms; },
    fire: () => handlers.forEach((fn) => fn()),
    doc,
    listen,
    notify,
    unlisten,
    dispose,
  };
};

describe('retainAuthSession', () => {
  it('holds one permanent listener so the session atom never unmounts', () => {
    const { listen, unlisten, dispose, doc } = setup();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(unlisten).not.toHaveBeenCalled();
    dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('refreshes on tab return at most once per throttle window', () => {
    const { fire, advance, notify } = setup();
    fire();
    fire();
    expect(notify).not.toHaveBeenCalled();
    advance(SESSION_FOCUS_MIN_INTERVAL_MS);
    fire();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('$sessionSignal');
    advance(SESSION_FOCUS_MIN_INTERVAL_MS - 1);
    fire();
    expect(notify).toHaveBeenCalledTimes(1);
    advance(1);
    fire();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('ignores the tab going hidden', () => {
    const { fire, advance, notify } = setup('hidden');
    advance(SESSION_FOCUS_MIN_INTERVAL_MS * 2);
    fire();
    expect(notify).not.toHaveBeenCalled();
  });
});
