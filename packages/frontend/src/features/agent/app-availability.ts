import type { AgentAppSummaryDto } from './api/agent-api';

export type AgentAppHealth = AgentAppSummaryDto['health'];

export const isAgentAppExecutableHealth = (health: AgentAppHealth): boolean =>
  health === 'healthy' || health === 'degraded';

export const canExecuteAgentApp = (app: Pick<AgentAppSummaryDto, 'enabled' | 'health'>): boolean =>
  app.enabled && isAgentAppExecutableHealth(app.health);
