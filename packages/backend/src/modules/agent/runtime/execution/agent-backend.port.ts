import type { TransientMessageDeltaPayload, TransientToolDeltaPayload } from '../events/event.types';
import type { RunView } from '../runs/run.types';

export type BackendSignal =
  | { type: 'durable'; runId: string; cursor: number }
  | { type: 'transient'; runId: string; eventType: 'message.delta'; payload: TransientMessageDeltaPayload }
  | { type: 'transient'; runId: string; eventType: 'tool.delta'; payload: TransientToolDeltaPayload }
  | { type: 'settled'; run: RunView };

export interface AgentBackendPort {
  execute(run: RunView, signal: AbortSignal): AsyncIterable<BackendSignal>;
}
