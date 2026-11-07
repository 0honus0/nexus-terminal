import { runFailureCode } from '../../runs/run-failure-rules.js';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import { AgentFailure, AgentResourceFenced, aggregateAgentFailures, isAgentDrainFailure } from '../../agent-failure.js';
import { OperationDispatchRefusal, OperationEffectFailure } from '../model/operation-failure.js';
import type { OperationModel } from '../model/operation-model.js';
import type {
	OperationExecution,
	OperationDispatchAuthority,
	OperationExecutionResult,
	OperationReceipt,
	OperationMutation,
	OperationScope,
	PreparedOperation,
} from '../model/operation-types.js';

interface ExecutionOwner {
	scope: OperationScope;
	accepting: boolean;
	pending: Set<Promise<unknown>>;
	children: Map<string, Set<Promise<unknown>>>;
	intents: Map<string, { hash: string; result: Promise<OperationExecutionResult> }>;
	closing: Promise<void> | null;
	fencing: Promise<boolean> | null;
	failures: unknown[];
}

function sameOwner(owner: ExecutionOwner | undefined, scope: OperationScope): owner is ExecutionOwner {
	return (
		owner !== undefined &&
		owner.scope.userId === scope.userId &&
		owner.scope.appId === scope.appId &&
		owner.scope.runId === scope.runId &&
		owner.scope.executionGeneration === scope.executionGeneration
	);
}

/** Generic lifetime and receipts; no model, tool catalogue or protocol service is a dependency. */
export class OperationService {
	private readonly owners = new Map<string, ExecutionOwner>();

	constructor(private readonly model: OperationModel) {}

	async verifyEffect(operation: OperationReceipt, allowCompleted = false): Promise<void> {
		if (!(await this.model.verifyEffect(operation, allowCompleted))) {
			throw new AgentFailure('version_conflict');
		}
	}

	confirmArtifacts(operation: OperationReceipt, ids: readonly string[]): Promise<void> {
		return this.model.confirmArtifacts(operation, ids);
	}

	async open(scope: OperationScope, runVersion: number, creationHash: string): Promise<void> {
		if (this.owners.has(scope.runId)) {
			throw new AgentFailure('active_run_conflict');
		}
		const owner: ExecutionOwner = {
			scope: {
				userId: scope.userId,
				appId: scope.appId,
				runId: scope.runId,
				executionGeneration: scope.executionGeneration,
			},
			accepting: false,
			pending: new Set(),
			children: new Map(),
			intents: new Map(),
			closing: null,
			fencing: null,
			failures: [],
		};
		this.owners.set(scope.runId, owner);
		try {
			if (!(await this.model.open(scope, runVersion, creationHash))) {
				throw new AgentFailure('version_conflict');
			}
			owner.accepting = true;
		} catch (error) {
			if (error instanceof AgentFailure && error.code !== 'operation_unknown') {
				this.owners.delete(scope.runId);
			}
			throw error;
		}
	}

	private async replay(input: OperationExecution): Promise<OperationExecutionResult> {
		const original = await this.model.get(input.intent.scope, input.intent.callerId, input.intent.operationKey);
		if (!original) {
			throw new AgentFailure('forbidden');
		}
		if (original.requestHash !== input.intent.requestHash) {
			throw new AgentFailure('idempotency_conflict');
		}
		return { kind: 'receipt', receipt: original };
	}

	execute(input: OperationExecution): Promise<OperationExecutionResult> {
		const scope = input.intent.scope;
		const owner = this.owners.get(scope.runId);
		if (!sameOwner(owner, scope)) {
			return this.replay(input);
		}
		const key = JSON.stringify([input.intent.callerId, input.intent.operationKey]);
		const original = owner.intents.get(key);
		if (original) {
			return original.hash === input.intent.requestHash
				? original.result
				: Promise.reject(new AgentFailure('idempotency_conflict'));
		}
		const task = Promise.resolve().then(() => {
			if (!owner.accepting || input.signal.aborted) {
				return this.replay(input);
			}
			return this.perform(owner, input);
		});
		owner.intents.set(key, { hash: input.intent.requestHash, result: task });
		owner.pending.add(task);
		let siblings: Set<Promise<unknown>> | null = null;
		if (input.intent.parentId !== null) {
			siblings = owner.children.get(input.intent.parentId) ?? new Set();
			owner.children.set(input.intent.parentId, siblings);
			siblings.add(task);
		}

		const release = () => {
			owner.pending.delete(task);
			// The durable owner is the replay authority, not an unbounded second result cache.
			if (owner.intents.get(key)?.result === task) {
				owner.intents.delete(key);
			}
			siblings?.delete(task);
			if (siblings?.size === 0 && input.intent.parentId !== null) {
				owner.children.delete(input.intent.parentId);
			}
		};

		void task.then(release, (error: unknown) => {
			release();
			if (isAgentDrainFailure(error) && !(input.signal.aborted && error === input.signal.reason)) {
				owner.failures.push(error);
			}
		});
		return task;
	}

	private async waitChildren(owner: ExecutionOwner, operation: OperationReceipt): Promise<void> {
		while (owner.children.get(operation.id)?.size) {
			await Promise.allSettled([...(owner.children.get(operation.id) ?? [])]);
		}
	}

	private async finish(
		owner: ExecutionOwner,
		operation: OperationReceipt,
		terminal: Parameters<OperationModel['finish']>[1],
		diagnosticCode: AgentRunFailureCode | null = null,
	): Promise<OperationExecutionResult> {
		await this.waitChildren(owner, operation);
		const ended = await this.model.finish(operation, terminal, diagnosticCode);
		if (ended.status !== 'ok') {
			throw new AgentFailure('operation_unknown');
		}
		if (ended.operation.state === 'unknown') {
			// A plugin returning successfully cannot turn an unresolved real effect into a completed Run.
			owner.failures.push(new AgentResourceFenced());
		}
		return { kind: 'receipt', receipt: ended.operation };
	}

	private async perform(owner: ExecutionOwner, input: OperationExecution): Promise<OperationExecutionResult> {
		// Preparation can read a provider/configuration or acquire no-effect metadata.
		// It must not run when the original receipt already exists. The admission
		// transaction repeats this lookup to resolve concurrent preparations safely.
		const original = await this.model.get(input.intent.scope, input.intent.callerId, input.intent.operationKey);
		if (original) {
			if (original.requestHash !== input.intent.requestHash) {
				throw new AgentFailure('idempotency_conflict');
			}
			return { kind: 'receipt', receipt: original };
		}
		const target: PreparedOperation = await input.prepare();
		const admitted = await this.model.admit(input.intent, () => target);
		if (admitted.status === 'scope_closed') {
			throw new AgentFailure('forbidden');
		}
		if (admitted.status === 'idempotency_conflict') {
			throw new AgentFailure('idempotency_conflict');
		}
		if (admitted.status === 'replayed') {
			return { kind: 'receipt', receipt: admitted.operation };
		}
		if (admitted.status === 'ephemeral') {
			await target.validate();
			await target.authorize(null);
			input.signal.throwIfAborted();
			return { kind: 'ephemeral', resultJson: await target.execute(null, input.signal) };
		}
		const operation = admitted.operation;
		let authority: OperationDispatchAuthority;
		try {
			await target.validate();
			authority = await target.authorize(operation);
			input.signal.throwIfAborted();
		} catch (error) {
			// throwIfAborted uses the original signal reason. Before dispatch, that
			// cancellation proves no effect started; it is not an unconfirmed drain.
			const cancelled = input.signal.aborted && error === input.signal.reason;
			if (isAgentDrainFailure(error) && !cancelled) {
				throw error;
			}
			return this.finish(
				owner,
				operation,
				input.signal.aborted
					? { state: 'cancelled' }
					: { state: 'failed', failureCode: error instanceof AgentFailure ? error.code : 'internal_failure' },
				runFailureCode(error, true),
			);
		}
		// An unknown dispatch commit must never be caught as an execution failure or retried.
		let dispatched: OperationMutation;
		try {
			dispatched = await this.model.dispatch(operation, authority);
		} catch (error) {
			if (error instanceof OperationDispatchRefusal) {
				return this.finish(owner, operation, { state: 'failed', failureCode: error.code });
			}
			throw error;
		}
		if (dispatched.status !== 'ok') {
			return this.finish(owner, operation, { state: 'cancelled' });
		}
		let resultJson: string;
		let executionStarted = false;
		try {
			await target.validate();
			input.signal.throwIfAborted();
			executionStarted = true;
			resultJson = await target.execute(dispatched.operation, input.signal);
		} catch (error) {
			if (
				error instanceof AgentFailure &&
				!(error instanceof OperationEffectFailure) &&
				!(error instanceof AgentResourceFenced) &&
				(error.code === 'operation_unknown' || error.code === 'storage_unavailable')
			) {
				throw error;
			}
			const unknown =
				error instanceof OperationEffectFailure
					? error.effect === 'unknown' || error.cleanup === 'unknown'
					: executionStarted && target.mayHaveExternalEffect;
			const result = await this.finish(
				owner,
				dispatched.operation,
				unknown
					? { state: 'unknown' }
					: input.signal.aborted
						? { state: 'cancelled' }
						: {
								state: 'failed',
								failureCode: error instanceof AgentFailure ? error.code : 'internal_failure',
							},
				runFailureCode(error, true),
			);
			if (error instanceof OperationEffectFailure && error.cleanup === 'unknown') {
				throw error;
			}
			return result;
		}
		return this.finish(owner, dispatched.operation, { state: 'completed', resultJson });
	}

	quiesce(scope: OperationScope): Promise<boolean> {
		const owner = this.owners.get(scope.runId);
		if (!sameOwner(owner, scope)) {
			throw new AgentFailure('forbidden');
		}
		owner.accepting = false;
		owner.fencing ??= this.model.closeAdmission(scope);
		return owner.fencing;
	}

	async settle(scope: OperationScope): Promise<void> {
		const owner = this.owners.get(scope.runId);
		if (!sameOwner(owner, scope) || owner.accepting) {
			throw new AgentFailure('forbidden');
		}
		while (owner.pending.size) {
			await Promise.allSettled([...owner.pending]);
		}
	}

	close(scope: OperationScope): Promise<void> {
		const owner = this.owners.get(scope.runId);
		if (!sameOwner(owner, scope)) {
			return Promise.reject(new AgentFailure('forbidden'));
		}
		owner.accepting = false;
		owner.closing ??= Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				await this.quiesce(scope);
			} catch (error) {
				failures.push(error);
			}
			while (owner.pending.size) {
				await Promise.allSettled([...owner.pending]);
			}
			try {
				if (!(await this.model.closed(scope))) {
					throw new AgentFailure('operation_unknown');
				}
			} catch (error) {
				failures.push(error);
			}
			failures.push(...owner.failures);
			if (!failures.some(isAgentDrainFailure)) {
				this.owners.delete(scope.runId);
			}
			if (failures.length) {
				throw aggregateAgentFailures(failures, 'Execution operations did not settle');
			}
			this.owners.delete(scope.runId);
		});
		return owner.closing;
	}
}
