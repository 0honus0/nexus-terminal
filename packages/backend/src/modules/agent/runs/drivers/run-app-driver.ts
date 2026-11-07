import { randomUUID } from 'node:crypto';
import { AgentFailure, aggregateAgentFailures, isAgentDrainFailure } from '../../agent-failure.js';
import type { OperationScope } from '../../operations/model/operation-types.js';
import type { OperationService } from '../../operations/service/operation-service.js';
import type { RunModel } from '../model/run-model.js';
import type {
	InvokeRunApp,
	RunAppCapabilityFactory,
	RunAppDriverExecution,
	RunAppExecutionDriver,
	RunAppCapabilitySession,
	RunAppOutcome,
} from '../model/run-app-driver-types.js';
import { runFailureCode } from '../run-failure-rules.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';

/** An App owns its complete algorithm. This driver owns only admission and final resource settlement. */
export class RunAppDriver implements RunAppExecutionDriver {
	constructor(
		private readonly runs: RunModel,
		private readonly operations: OperationService,
		private readonly capabilities: RunAppCapabilityFactory,
		private readonly invoke: InvokeRunApp,
		private readonly logger?: Logger,
	) {}

	async execute(execution: RunAppDriverExecution): Promise<void> {
		const { command, frozen, signal } = execution;
		if (frozen.appExecution.kind !== 'plugin') {
			throw new AgentFailure('provider_unavailable');
		}
		const scope: OperationScope = {
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			executionGeneration: randomUUID(),
		};
		try {
			await this.operations.open(scope, command.version, command.requestHash);
		} catch (error) {
			this.runs.rememberFailure(scope.userId, scope.appId, scope.runId, {
				code: runFailureCode(error),
				toolName: null,
			});
			// An uncertain admission must be reconciled by the original durable owner;
			// never start the App or speculate a terminal write after an unknown commit.
			if (isAgentDrainFailure(error)) {
				throw error;
			}
			await this.runs.failUnstarted({
				userId: scope.userId,
				appId: scope.appId,
				runId: scope.runId,
				expectedVersion: command.version,
				creationHash: command.requestHash,
				now: Date.now(),
			});
			return;
		}

		const mutation = (version: number) => ({
			userId: scope.userId,
			appId: scope.appId,
			runId: scope.runId,
			executionGeneration: scope.executionGeneration,
			creationHash: command.requestHash,
			expectedVersion: version,
		});

		const assertCurrent = async (): Promise<void> => {
			signal.throwIfAborted();
			if (Date.now() >= command.deadlineAt) {
				throw new AgentFailure('limit_exceeded');
			}
			const current = await this.runs.getExecutionState(scope.userId, scope.appId, scope.runId);
			if (current?.status !== 'running') {
				throw new AgentFailure('version_conflict');
			}
			signal.throwIfAborted();
		};

		const operation: OperationService['execute'] = (input) => {
			const task = this.operations.execute(input);
			void task.catch((error: unknown) => {
				if (isAgentDrainFailure(error) && !(signal.aborted && error === signal.reason)) {
					// An App may recover an ordinary tool refusal. Unconfirmed Host
					// persistence must stop its whole resource family immediately.
					execution.onBackgroundFailure(error, 'operation');
				}
			});
			return task;
		};

		let session: RunAppCapabilitySession | null = null;
		const failures: unknown[] = [];
		let outputJson: string | null = null;
		let outcome: RunAppOutcome | null = null;
		try {
			const capabilitySession = this.capabilities.open({
				execution,
				scope,
				assertCurrent,

				reportFailure: (error) =>
					this.runs.rememberFailure(scope.userId, scope.appId, scope.runId, {
						code: runFailureCode(error),
						toolName: null,
					}),

				operation,

				settleOperations: () => this.operations.settle(scope),
			});
			session = capabilitySession;
			await capabilitySession.ready();
			const admitted = await this.runs.startApp(mutation(command.version));
			if (admitted.status !== 'ok') {
				throw new AgentFailure('version_conflict');
			}
			await assertCurrent();
			const result = await this.invoke({
				scope,
				execution: frozen.appExecution,
				inputJson: frozen.inputJson,
				deadlineUnixMs: command.deadlineAt,
				signal,
				assertCurrent,

				authorize: (source) => capabilitySession.authorize(source),

				visibleCapabilities: (source) => capabilitySession.visibleCapabilities(source),

				visibleToolKeys: () => capabilitySession.visibleToolKeys(),

				operation,

				capability: (input, source, signal) => capabilitySession.call(input, source, signal),
			});
			await capabilitySession.validateResult(result);
			outcome = result;
			if (result.kind === 'complete') {
				outputJson = JSON.stringify({
					kind: 'complete',
					outputs: result.outputs.map((item) => ({
						id: item.id,
						sha256: item.sha256,
						sizeBytes: item.sizeBytes,
						mediaType: item.mediaType,
					})),
				});
			}
		} catch (error) {
			failures.push(error);
			this.runs.rememberFailure(scope.userId, scope.appId, scope.runId, {
				code: runFailureCode(error),
				toolName: null,
			});
			logDiagnostic(
				this.logger,
				'warn',
				'AGENT_APP_EXECUTION_FAILED',
				{
					appId: scope.appId,
					runId: scope.runId,
					generation: scope.executionGeneration,
				},
				error,
			);
		}
		// Close admission synchronously before any drain await. Already accepted child
		// effects retain their original owner and are awaited independently of the App result.
		try {
			await this.operations.quiesce(scope);
		} catch (error) {
			failures.push(error);
		}
		try {
			// Already dispatched background work must retain its proof while its real owner closes I/O.
			// The in-process admission fence prevents new effects during this drain.
			await session?.drain(failures.length === 0 && outcome?.kind === 'complete');
		} catch (error) {
			failures.push(error);
		}
		try {
			await this.operations.close(scope);
		} catch (error) {
			failures.push(error);
		}
		{
			const current = await this.runs.getExecutionState(scope.userId, scope.appId, scope.runId);
			if (current?.status === 'running' || current?.status === 'pending') {
				const uncertain = failures.some(
					(error) =>
						isAgentDrainFailure(error) ||
						(error instanceof AgentFailure && error.code === 'operation_unknown'),
				);
				const terminal =
					failures.length === 0 && outcome?.kind === 'suspend'
						? {
								state: 'suspended' as const,
								checkpointVersion: outcome.checkpointVersion,
								inputRequest: {
									id: outcome.inputRequest.id,
									sha256: outcome.inputRequest.sha256,
									sizeBytes: outcome.inputRequest.sizeBytes,
									mediaType: outcome.inputRequest.mediaType,
								},
							}
						: failures.length === 0 && outputJson !== null
							? { state: 'completed' as const, outputJson }
							: { state: uncertain ? ('unknown' as const) : ('failed' as const) };
				const finished = await this.runs.finishApp(mutation(current.version), terminal);
				if (finished.status !== 'ok') {
					failures.push(new AgentFailure('operation_unknown'));
				}
			}
		}
		const retained = failures.filter(isAgentDrainFailure);
		if (retained.length) {
			throw aggregateAgentFailures(retained, 'App execution or resource settlement unconfirmed');
		}
	}
}
