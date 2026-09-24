/**
 * Minimal SSE stream parser for the AI Assistant.
 *
 * Reads a fetch `ReadableStream`, reassembles `event:`/`data:` frames across
 * arbitrary chunk boundaries, skips comment heartbeats (`: ping`) and
 * malformed lines, and flushes a final unterminated frame at end-of-stream.
 */
export interface SseEvent {
  event: string;
  data: string;
}

export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  const flushFrame = (): void => {
    if (eventName !== '' && dataLines.length > 0) {
      onEvent({ event: eventName, data: dataLines.join('\n') });
    }
    eventName = '';
    dataLines = [];
  };

  const consumeLine = (line: string): void => {
    if (line === '') {
      flushFrame();
      return;
    }
    if (line.startsWith(':')) return; // comment heartbeat
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trimStart();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
      return;
    }
    // Malformed / unsupported field (id:, retry:, garbage) — skipped.
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      consumeLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) consumeLine(buffer.replace(/\r$/, ''));
  // Final unterminated frame (stream ended without the trailing blank line).
  flushFrame();
}
