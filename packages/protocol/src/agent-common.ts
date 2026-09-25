export type AgentJsonValueDto =
  null | boolean | number | string | AgentJsonValueDto[] | { [key: string]: AgentJsonValueDto };

export type AgentVersionedRequestDto<T extends object> = T & { schemaVersion: 1 };

export type AgentToolRiskDto = 'read' | 'control' | 'mutate' | 'destructive' | 'forbidden';

export interface AgentEnvelopeDto<T> {
  data: T;
  requestId: string;
}

export interface AgentErrorBodyDto {
  code: string;
  message: string;
  details?: unknown;
}

export interface AgentErrorEnvelopeDto {
  error: AgentErrorBodyDto;
  requestId: string;
}

export interface AgentCsrfResponseDto {
  token: string;
}
