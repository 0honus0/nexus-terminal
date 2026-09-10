import { parseSseStream } from './sse-parser';

export interface AgentStreamEvent<T = unknown> {
  id?: string;
  type: string;
  payload: T;
  occurredAt?: number;
}

const jsonPayload = (data: string): { payload?: unknown; occurredAt?: number } => {
  if (!data) return {};
  const parsed = JSON.parse(data) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { payload?: unknown; occurredAt?: number })
    : { payload: parsed };
};

async function* connect(path: string, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`AGENT_SSE_HTTP_${response.status}`);
  for await (const event of parseSseStream(response.body, signal)) {
    const body = jsonPayload(event.data);
    yield {
      ...(event.id ? { id: event.id } : {}),
      type: event.event,
      payload: body.payload,
      ...(body.occurredAt === undefined ? {} : { occurredAt: body.occurredAt }),
    };
  }
}

export const agentEvents = {
  host(cursor: number, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    return connect(`/api/v1/agent/events?cursor=${encodeURIComponent(String(cursor))}`, signal);
  },
  run(appId: string, runId: string, cursor: number, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    return connect(
      `/api/v1/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/events?cursor=${encodeURIComponent(String(cursor))}`,
      signal,
    );
  },
};
