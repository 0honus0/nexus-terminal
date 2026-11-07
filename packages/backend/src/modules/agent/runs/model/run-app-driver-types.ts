import type { RunExecutionCommand, RunFrozenInput } from './run-types.js';
import type {
	OperationScope,
	OperationExecution,
	OperationExecutionResult,
} from '../../operations/model/operation-types.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { PluginRunInvocation, PluginCapabilitySource } from '../../plugins/model/plugin-run-types.js';
import type { PluginCapabilityRequest, PluginCapabilityReply } from '../../plugins/model/plugin-invocation-types.js';

export interface RunAppDriverExecution {
	command: RunExecutionCommand;
	frozen: RunFrozenInput;
	signal: AbortSignal;
	onBackgroundFailure(error: unknown, operationName: string): void;
}

export interface RunAppExecutionDriver {
	execute(execution: RunAppDriverExecution): Promise<void>;
}

export interface RunAppDriverRegistration {
	id: string;
	supports(input: RunFrozenInput): boolean;
	driver: RunAppExecutionDriver;
}

/** The assembly installs actual capabilities; the execution kernel needs no particular capability. */
export interface RunAppCapabilitySession {
	ready(): Promise<void>;
	visibleToolKeys(): Promise<readonly string[] | null>;
	call(
		input: PluginCapabilityRequest,
		source: PluginCapabilitySource,
		signal: AbortSignal,
	): Promise<PluginCapabilityReply>;
	authorize(source: PluginCapabilitySource): Promise<OperationDispatchAuthority>;
	visibleCapabilities(source: PluginCapabilitySource): Promise<AgentCapability[]>;
	drain(completed: boolean): Promise<void>;
	validateResult(result: RunAppOutcome): Promise<void>;
}

export interface RunAppCapabilityFactory {
	open(input: {
		execution: RunAppDriverExecution;
		scope: OperationScope;
		assertCurrent(): Promise<void>;
		reportFailure(error: unknown): void;
		operation(input: OperationExecution): Promise<OperationExecutionResult>;
		settleOperations(): Promise<void>;
	}): RunAppCapabilitySession;
}

export type RunAppOutcome =
	| {
			kind: 'complete';
			outputs: { id: string; sha256: string; sizeBytes: number; mediaType: string }[];
	  }
	| {
			kind: 'suspend';
			checkpointVersion: number;
			inputRequest: { id: string; sha256: string; sizeBytes: number; mediaType: string };
	  };

export type InvokeRunApp = (input: PluginRunInvocation) => Promise<RunAppOutcome>;
