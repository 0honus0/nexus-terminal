import { artifactErrorRules } from './artifacts';
import { collaborationErrorRules } from './collaboration';
import { commonErrorRules } from './common';
import { integrationErrorRules } from './integrations';
import { pluginErrorRules } from './plugins';
import { providerErrorRules } from './providers';
import type { AgentErrorMapping, AgentErrorRule } from './rule';
import { runErrorRules } from './runs';
import { AgentRequestError } from '../agent-route-input';
import { workspaceRuntimeErrorRules } from './workspace-runtime';

const agentErrorRules: readonly AgentErrorRule[] = [
  ...providerErrorRules,
  ...artifactErrorRules,
  ...integrationErrorRules,
  ...workspaceRuntimeErrorRules,
  ...collaborationErrorRules,
  ...pluginErrorRules,
  ...runErrorRules,
  ...commonErrorRules,
];

export const mapAgentError = (error: unknown): AgentErrorMapping => {
  const raw = error instanceof Error ? error.message : String(error);
  const rule = agentErrorRules.find((candidate) => candidate.matches(raw));
  const mapped = rule?.mapping(raw) ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Agent request failed.' };
  return error instanceof AgentRequestError ? { ...mapped, details: error.details } : mapped;
};
