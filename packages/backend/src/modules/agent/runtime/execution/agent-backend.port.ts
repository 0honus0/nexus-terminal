import type {
  AgentTransientMessageDeltaPayloadDto,
  AgentTransientToolDeltaPayloadDto,
} from '@nexus-terminal/protocol/agent-events';
import type { RunView } from '../runs/run.types';

export type BackendSignal =
  | { type: 'durable'; runId: string; cursor: number }
  | { type: 'transient'; runId: string; eventType: 'message.delta'; payload: AgentTransientMessageDeltaPayloadDto }
  | { type: 'transient'; runId: string; eventType: 'tool.delta'; payload: AgentTransientToolDeltaPayloadDto }
  | { type: 'settled'; run: RunView };

export interface AgentBackendPort {
  execute(run: RunView, signal: AbortSignal): AsyncIterable<BackendSignal>;
}
