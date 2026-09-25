export type AgentIntegrationKindDto = 'mcp' | 'acp';

export interface AgentMcpIntegrationConfigurationDto {
  displayName: string;
  transport: 'streamable-http';
  endpoint: string;
  privateHostExceptions: string[];
  protocolVersion: '2026-07-28';
  trustToolAnnotations?: boolean;
}

export interface AgentAcpIntegrationConfigurationDto {
  displayName: string;
  transport: 'workspace-profile';
  profileId: string;
  protocolVersion: '1';
}

export type AgentIntegrationConfigurationDto =
  AgentMcpIntegrationConfigurationDto | AgentAcpIntegrationConfigurationDto;

export interface AgentIntegrationViewDto {
  id: string;
  userId: number;
  appId: string;
  kind: AgentIntegrationKindDto;
  configuration: AgentIntegrationConfigurationDto;
  hasCredential: boolean;
  credentialRevision: number;
  schemaHash: string | null;
  enabled: boolean;
  refreshState: 'idle' | 'refreshing' | 'ready' | 'error';
  lastErrorCode: string | null;
  /** Unix epoch seconds for the latest refresh attempt/success and scheduled retry. */
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextRetryAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentIntegrationListQueryDto {
  kind?: AgentIntegrationKindDto;
}

export interface AgentMcpIntegrationCreateRequestDto {
  kind: 'mcp';
  configuration: AgentMcpIntegrationConfigurationDto;
  enabled: boolean;
  credential?: string;
}

export interface AgentAcpIntegrationCreateRequestDto {
  kind: 'acp';
  configuration: AgentAcpIntegrationConfigurationDto;
  enabled: boolean;
}

export type AgentIntegrationCreateRequestDto =
  AgentMcpIntegrationCreateRequestDto | AgentAcpIntegrationCreateRequestDto;

export interface AgentMcpIntegrationUpdateFieldsDto {
  kind: 'mcp';
  configuration: AgentMcpIntegrationConfigurationDto;
  enabled: boolean;
  credential?: string;
  clearCredential?: boolean;
}

export interface AgentAcpIntegrationUpdateFieldsDto {
  kind: 'acp';
  configuration: AgentAcpIntegrationConfigurationDto;
  enabled: boolean;
}

export type AgentIntegrationUpdateFieldsDto = AgentMcpIntegrationUpdateFieldsDto | AgentAcpIntegrationUpdateFieldsDto;

export type AgentIntegrationUpdateRequestDto = AgentIntegrationUpdateFieldsDto & {
  expectedVersion: number;
};

export interface AgentIntegrationDeleteQueryDto {
  expectedVersion: number;
}

export interface AgentIntegrationDeleteResponseDto {
  integrationId: string;
  deleted: true;
}

export interface AgentIntegrationRefreshDto {
  integration: AgentIntegrationViewDto;
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
}
