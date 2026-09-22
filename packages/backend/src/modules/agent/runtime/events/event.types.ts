import type {
  AgentTransientApprovalChangedPayloadDto,
  AgentTransientMessageDeltaPayloadDto,
  AgentTransientToolDeltaPayloadDto,
} from '@nexus-terminal/protocol/agent-events';

export type TransientRunEvent =
  | {
      runId: string;
      type: 'message.delta';
      payload: AgentTransientMessageDeltaPayloadDto;
      occurredAt: number;
    }
  | {
      runId: string;
      type: 'tool.delta';
      payload: AgentTransientToolDeltaPayloadDto;
      occurredAt: number;
    }
  | {
      runId: string;
      type: 'approval.changed';
      payload: AgentTransientApprovalChangedPayloadDto;
      occurredAt: number;
    };
