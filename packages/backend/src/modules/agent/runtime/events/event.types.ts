export interface ModelAttemptIdentity {
  attemptId: string;
  attemptIndex: number;
}

export interface TransientMessageDeltaPayload extends ModelAttemptIdentity {
  text: string;
  runtimeId?: string;
  delegationId?: string;
}

export interface TransientToolDeltaPayload extends ModelAttemptIdentity {
  index: number;
  id: string | null;
  name: string | null;
  argumentsDelta: string;
  runtimeId?: string;
  delegationId?: string;
}

export type TransientRunEvent =
  | {
      runId: string;
      type: 'message.delta';
      payload: TransientMessageDeltaPayload;
      occurredAt: number;
    }
  | {
      runId: string;
      type: 'tool.delta';
      payload: TransientToolDeltaPayload;
      occurredAt: number;
    };
