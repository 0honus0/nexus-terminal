import type { AgentTargetKind, AgentTargetSelector } from '../capabilities/tool-target.types';

export const AGENT_CAPABILITIES = [
  'file.read',
  'file.write',
  'file.delete',
  'machine.inspect',
  'shell.execute',
  'machine.docker.manage',
  'workspace.manage',
  'browser.read',
  'browser.interact',
  'integration.mcp.read',
  'integration.mcp.invoke',
  'integration.acp.invoke',
  'artifacts.read',
  'app.intents.exchange',
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export interface GlobalCapabilityScope {
  kind: 'global';
}

export type TargetGrantSelection = { mode: 'all' } | { mode: 'ids'; ids: string[] };

export interface TargetCapabilityScope {
  kind: 'targets';
  targets: Partial<Record<AgentTargetKind, TargetGrantSelection>>;
}

export type CapabilityGrantScope = GlobalCapabilityScope | TargetCapabilityScope;

export interface CapabilityGrant {
  capability: AgentCapability;
  schemaVersion: 2;
  scope: CapabilityGrantScope;
  grantedAt: number;
}

export interface CapabilityGrantInput {
  capability: AgentCapability;
  scope: CapabilityGrantScope;
}

export interface CapabilityResource {
  connectionId?: number;
  target?: AgentTargetSelector;
}

export type CapabilityScopeKind = CapabilityGrantScope['kind'];

export interface CapabilityDefinitionView {
  id: AgentCapability;
  scopeKind: CapabilityScopeKind;
  supportedTargets: AgentTargetKind[];
  defaultScope: CapabilityGrantScope;
}
