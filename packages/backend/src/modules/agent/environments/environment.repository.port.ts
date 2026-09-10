import type { JsonValue, Scope } from '../agent.types';
import type { PluginRunnerTarget } from '../host/plugin-runner-target.port';
import type {
  EnvironmentCommandView,
  EnvironmentGroupDetail,
  EnvironmentGroupView,
  EnvironmentNetworkPolicy,
  EnvironmentPackRef,
  EnvironmentResourceLimits,
  EnvironmentStatus,
  EnvironmentView,
} from './environment.types';

export interface CreateEnvironmentGroupRecord {
  scope: Scope;
  id: string;
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  runId: string;
  agentRuntimeId: string;
  retained: boolean;
  limits: JsonValue;
  createdAt: number;
}

export interface CreateEnvironmentRecord {
  id: string;
  groupId: string;
  kind: EnvironmentView['kind'];
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  packRefs: EnvironmentPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  generation: number;
  limits: EnvironmentResourceLimits;
  network: EnvironmentNetworkPolicy;
  createdAt: number;
}

export interface CreateEnvironmentCommandRecord {
  scope: Scope;
  id: string;
  environmentId?: string;
  groupId?: string;
  action: string;
  operationHash: string;
  generation: number;
  request: JsonValue;
  deadlineAt: number;
  createdAt: number;
}

export interface EnvironmentRepositoryPort {
  createGroup(
    group: CreateEnvironmentGroupRecord,
    environments: CreateEnvironmentRecord[],
  ): Promise<EnvironmentGroupDetail>;
  listGroups(scope: Scope, runId?: string): Promise<EnvironmentGroupView[]>;
  listUserEnvironments(
    userId: number,
  ): Promise<Array<{ appId: string; retained: boolean; environment: EnvironmentView }>>;
  getGroup(scope: Scope, groupId: string): Promise<EnvironmentGroupDetail | null>;
  getEnvironment(scope: Scope, environmentId: string): Promise<EnvironmentView | null>;
  setEnvironmentStatus(
    scope: Scope,
    environmentId: string,
    expectedVersion: number,
    status: EnvironmentStatus,
    now: number,
  ): Promise<EnvironmentView>;
  refreshGroupStatus(scope: Scope, groupId: string, now: number): Promise<EnvironmentGroupDetail>;
  createCommand(record: CreateEnvironmentCommandRecord): Promise<EnvironmentCommandView>;
  getCommand(scope: Scope, commandId: string): Promise<EnvironmentCommandView | null>;
  completeCommand(
    scope: Scope,
    commandId: string,
    status: EnvironmentCommandView['status'],
    result: JsonValue | null,
    now: number,
  ): Promise<EnvironmentCommandView>;
  listPendingCommands(limit: number): Promise<EnvironmentCommandView[]>;
}
