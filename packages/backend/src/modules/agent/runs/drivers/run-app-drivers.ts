import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';
import type { RunDriverExecution, RunExecutionScope } from '../model/run-driver-types.js';
import type { RunAppExecutionDriver, RunAppDriverRegistration } from '../model/run-app-driver-types.js';
import type { RunExecutionCommand, RunFrozenInput } from '../model/run-types.js';
import type { RunModel } from '../model/run-model.js';
import type { RunExecutionOwner } from '../service/run-execution-owner.js';
import { runFailureCode } from '../run-failure-rules.js';

/** Selects an exact installed App implementation without imposing a model or protocol. */
export class RunAppDrivers {
	private readonly registrations: readonly RunAppDriverRegistration[];

	constructor(
		private readonly runs: RunModel,
		registrations: readonly RunAppDriverRegistration[],
	) {
		const ids = new Set<string>();
		this.registrations = Object.freeze(
			registrations.map((registration) => {
				if (!registration.id || ids.has(registration.id)) {
					throw new AgentFailure('internal_failure');
				}
				ids.add(registration.id);
				const execute = registration.driver.execute.bind(registration.driver);
				return Object.freeze({
					id: registration.id,
					supports: registration.supports,
					driver: Object.freeze({ execute }),
				});
			}),
		);
	}

	start(owner: RunExecutionOwner, input: RunExecutionCommand, parentId: string | null = null): boolean {
		const command: RunExecutionCommand = Object.freeze({
			userId: input.userId,
			appId: input.appId,
			runId: input.runId,
			version: input.version,
			requestHash: input.requestHash,
			deadlineAt: input.deadlineAt,
			inputJson: input.inputJson,
			prompt: input.prompt,
		});
		const scope: RunExecutionScope = {
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			version: command.version,
			requestHash: command.requestHash,
			deadlineAt: command.deadlineAt,
		};
		const handle = owner.start(scope, { execute: (execution) => this.execute(command, execution) }, parentId);
		if (!handle) {
			return false;
		}
		return true;
	}

	private resolve(input: RunFrozenInput): RunAppExecutionDriver {
		const matching = this.registrations.filter((registration) => registration.supports(input));
		if (matching.length === 0) {
			throw new AgentFailure('provider_unavailable');
		}
		if (matching.length !== 1) {
			throw new AgentFailure('internal_failure');
		}
		return matching[0].driver;
	}

	private async execute(command: RunExecutionCommand, execution: RunDriverExecution): Promise<void> {
		const frozen = await this.runs.frozen(command.userId, command.appId, command.runId);
		if (
			!frozen ||
			frozen.appExecution.kind !== 'plugin' ||
			frozen.inputJson !== command.inputJson ||
			execution.signal.aborted
		) {
			await this.failUnstarted(command);
			return;
		}
		let driver: RunAppExecutionDriver;
		try {
			driver = this.resolve(frozen);
		} catch (error) {
			this.runs.rememberFailure(command.userId, command.appId, command.runId, {
				code: runFailureCode(error),
				toolName: null,
			});
			await this.failUnstarted(command);
			if (isAgentDrainFailure(error)) {
				throw error;
			}
			return;
		}
		await driver.execute({
			command,
			frozen,
			signal: execution.signal,

			onBackgroundFailure: (error, operationName) =>
				execution.onBackgroundFailure(
					{
						code: runFailureCode(error, true),
						toolName: operationName,
					},
					error,
				),
		});
	}

	private failUnstarted(command: RunExecutionCommand): Promise<boolean> {
		return this.runs.failUnstarted({
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			expectedVersion: command.version,
			creationHash: command.requestHash,
			now: Date.now(),
		});
	}
}
