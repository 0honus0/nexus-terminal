import type { JsonValue } from '../agent.types';
import type { ToolContext } from './tool.types';

export interface MachineConnectionSummary {
  id: number;
  name: string | null;
  host: string;
  port: number;
  username: string;
}

export interface AgentDiagnosticReport {
  generatedAt: number;
  observations: readonly JsonValue[];
}

export interface AgentDiagnosticsPort {
  run(connectionId: number, probeIds: readonly string[], actorId: string): Promise<AgentDiagnosticReport>;
}

export interface DockerMutationInspection {
  containerId: string;
  state: string;
  image: string;
}

export interface DockerMutationResult extends DockerMutationInspection {
  action: 'start' | 'stop' | 'restart' | 'remove';
  confirmed: boolean;
}

export interface MachineCapabilityPort {
  listConnections(context: ToolContext): Promise<MachineConnectionSummary[]>;
  diagnose(
    context: ToolContext,
    connectionId: number,
    probeIds: readonly string[],
    actorId: string,
    signal: AbortSignal,
  ): Promise<AgentDiagnosticReport>;
  inspectDockerContainer(
    context: ToolContext,
    connectionId: number,
    containerId: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationInspection>;
  mutateDockerContainer(
    context: ToolContext,
    connectionId: number,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'remove',
    expectedState: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationResult>;
}
