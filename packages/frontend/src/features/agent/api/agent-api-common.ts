import type { AgentCsrfResponseDto } from '@nexus-terminal/protocol/agent-common';
import type { AgentEnvelope } from './agent-api.types';
import { agentHttpClient as httpClient } from './agent-http-client';

let csrfToken: string | null = null;

export { httpClient };

export const unwrap = <T>(envelope: AgentEnvelope<T>): T => envelope.data;

const csrf = async (): Promise<string> => {
  if (csrfToken) return csrfToken;
  const response = await httpClient.get<AgentEnvelope<AgentCsrfResponseDto>>('/agent/security/csrf');
  csrfToken = response.data.data.token;
  return csrfToken;
};

export const mutationHeaders = async (): Promise<Record<string, string>> => ({ 'X-Nexus-CSRF': await csrf() });

export const resetAgentCsrf = (): void => {
  csrfToken = null;
};
