import type { JsonValue } from '../../agent.types';
import type { RunView } from '../runs/run.types';

export type BackendSignal =
  | { type: 'durable'; runId: string; cursor: number }
  | { type: 'transient'; runId: string; eventType: 'message.delta' | 'tool.delta'; payload: JsonValue }
  | { type: 'settled'; run: RunView };

export interface AgentBackendPort {
  execute(run: RunView, signal: AbortSignal): AsyncIterable<BackendSignal>;
}
