import { createParser, type EventSourceMessage } from 'eventsource-parser';

export interface ParsedSseEvent {
  id?: string;
  event: string;
  data: string;
}

const MAX_SSE_BUFFER_CHARS = 1024 * 1024;

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: EventSourceMessage[] = [];
  const parser = createParser({
    maxBufferSize: MAX_SSE_BUFFER_CHARS,
    onEvent: (event) => events.push(event),
    onError: (error) => {
      throw error;
    },
  });
  const abort = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      while (events.length > 0) {
        const event = events.shift()!;
        yield {
          ...(event.id === undefined ? {} : { id: event.id }),
          event: event.event || 'message',
          data: event.data,
        };
      }
    }
    const tail = decoder.decode();
    if (tail) parser.feed(tail);
    while (events.length > 0) {
      const event = events.shift()!;
      yield {
        ...(event.id === undefined ? {} : { id: event.id }),
        event: event.event || 'message',
        data: event.data,
      };
    }
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
