import type { JsonValue } from '../../agent.types';

export interface TransientRunEvent {
  runId: string;
  type: 'message.delta' | 'tool.delta';
  payload: JsonValue;
  occurredAt: number;
}
