export interface AgentTerminalAttachQueryDto {
  appId: string;
  workspaceId: string;
  generation: number;
  columns: number;
  rows: number;
  sessionId?: string;
}

export interface AgentTerminalResizeMessageDto {
  type: 'resize';
  columns: number;
  rows: number;
}

export interface AgentTerminalSignalMessageDto {
  type: 'signal';
  signal: string;
}

export interface AgentTerminalCloseMessageDto {
  type: 'close';
}

export type AgentTerminalClientControlMessageDto =
  AgentTerminalResizeMessageDto | AgentTerminalSignalMessageDto | AgentTerminalCloseMessageDto;

export interface AgentTerminalReadyMessageDto {
  type: 'ready';
  generation: number;
  sessionId: string;
}

export type AgentTerminalServerControlMessageDto = AgentTerminalReadyMessageDto;
