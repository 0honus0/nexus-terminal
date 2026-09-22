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
