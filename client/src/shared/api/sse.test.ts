import { describe, expect, it, vi } from 'vitest';
import { parseSseStream, type SseEvent } from './sse';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(...chunks: string[]): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  await parseSseStream(streamOf(...chunks), (event) => events.push(event));
  return events;
}

describe('parseSseStream', () => {
  it('parses complete event/data frames', async () => {
    const events = await collect(
      'event: meta\ndata: {"a":1}\n\nevent: delta\ndata: {"text":"hi"}\n\n',
    );
    expect(events).toEqual([
      { event: 'meta', data: '{"a":1}' },
      { event: 'delta', data: '{"text":"hi"}' },
    ]);
  });

  it('reassembles frames split across arbitrary chunk boundaries', async () => {
    const events = await collect(
      'eve',
      'nt: del',
      'ta\nda',
      'ta: {"text":"he',
      'llo"}\n',
      '\nevent: done\ndata: {}\n\n',
    );
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"hello"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('skips comment heartbeats and malformed lines', async () => {
    const events = await collect(
      ': ping\n\n',
      'id: 7\nretry: 100\ngarbage line\n',
      'event: delta\ndata: {"text":"x"}\n\n',
      ': another ping\n\n',
    );
    expect(events).toEqual([{ event: 'delta', data: '{"text":"x"}' }]);
  });

  it('joins multi-line data blocks with newlines', async () => {
    const events = await collect('event: delta\ndata: line1\ndata: line2\n\n');
    expect(events).toEqual([{ event: 'delta', data: 'line1\nline2' }]);
  });

  it('flushes a final unterminated frame at end of stream', async () => {
    const events = await collect('event: done\ndata: {"finishReason":"stop"}');
    expect(events).toEqual([{ event: 'done', data: '{"finishReason":"stop"}' }]);
  });

  it('handles CRLF line endings', async () => {
    const events = await collect('event: delta\r\ndata: {"text":"crlf"}\r\n\r\n');
    expect(events).toEqual([{ event: 'delta', data: '{"text":"crlf"}' }]);
  });

  it('drops frames that carry an event with no data or data with no event', async () => {
    const events = await collect(
      'event: lonely\n\n',
      'data: {"orphan":true}\n\n',
      'event: ok\ndata: 1\n\n',
    );
    expect(events).toEqual([{ event: 'ok', data: '1' }]);
  });

  it('handles multi-byte UTF-8 characters split across chunks', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('event: delta\ndata: {"text":"héllo — ✓"}\n\n');
    const mid = 24; // splits inside the multi-byte sequence region
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    });
    const onEvent = vi.fn();
    await parseSseStream(stream, onEvent);
    expect(onEvent).toHaveBeenCalledWith({
      event: 'delta',
      data: '{"text":"héllo — ✓"}',
    });
  });

  it('resolves on an empty stream without emitting', async () => {
    const events = await collect();
    expect(events).toEqual([]);
  });
});
