import { randomUUID } from 'node:crypto';
import { AGENT_INTEGRATION_MAX_ITEMS } from '@nexus-terminal/shared/agent/integrations/values';
import { AgentFailure, isAgentDrainFailure, ToolExecutionUnknown, ToolCleanupFailure } from '../../agent-failure.js';
import type { IntegrationModel } from '../model/integration-model.js';
import type {
	IntegrationActor,
	IntegrationInput,
	IntegrationFacts,
	IntegrationRecord,
	IntegrationDiscovery,
	IntegrationInvocation,
	IntegrationPendingInput,
	AcpIntegrationInvocation,
	IntegrationCatalogInput,
} from '../model/integration-types.js';

const MAX_PENDING_INPUTS = 128;

const PENDING_INPUT_TTL_MS = 10 * 60 * 1000;

export class IntegrationService {
	private readonly stop = new AbortController();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly inputs = new Map<string, IntegrationPendingInput>();
	private inputReservations = 0;
	private readonly failures: unknown[] = [];
	private readonly lanes = new Map<string, Promise<unknown>>();
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: IntegrationModel) {}

	private admit(actor: IntegrationActor, facts: IntegrationFacts, creating = false): void {
		if (facts.identityUserId !== actor.userId) {
			throw new AgentFailure('unauthenticated');
		}
		if (!facts.exists) {
			throw new AgentFailure('not_found');
		}
		if (creating && facts.count >= AGENT_INTEGRATION_MAX_ITEMS) {
			throw new AgentFailure('limit_exceeded');
		}
	}

	private task<T>(key: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.closing || this.pending.size >= 16) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const deadline = AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]);
		const task = (this.lanes.get(key) ?? Promise.resolve()).then(() => {
			if (this.closing || deadline.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(deadline);
		});
		this.pending.add(task);
		const lane = task.then(
			() => undefined,
			() => undefined,
		);
		this.lanes.set(key, lane);
		void task.then(
			() => this.settled(key, task, lane),
			(error) => {
				if (
					isAgentDrainFailure(error) &&
					(!(error instanceof ToolExecutionUnknown) || error instanceof ToolCleanupFailure)
				) {
					this.failures.push(error);
					this.quiesce();
				}
				this.settled(key, task, lane);
			},
		);
		return task;
	}

	private settled(key: string, task: Promise<unknown>, lane: Promise<unknown>): void {
		this.pending.delete(task);
		if (this.lanes.get(key) === lane) {
			this.lanes.delete(key);
		}
	}

	list(actor: IntegrationActor): Promise<IntegrationRecord[]> {
		return this.task(actor.appId, () => this.model.list(actor));
	}

	get(actor: IntegrationActor, id: string): Promise<IntegrationRecord> {
		return this.task(id, () => this.model.get(actor, id));
	}

	create(actor: IntegrationActor, key: string, input: IntegrationInput): Promise<IntegrationRecord> {
		if (
			input.credential.action === 'keep' ||
			(input.configuration.kind === 'acp' && input.credential.action !== 'clear')
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.task(actor.appId, () =>
			this.model.create(
				actor,
				randomUUID(),
				key,
				input,
				(facts) => this.admit(actor, facts),
				(facts) => this.admit(actor, facts, true),
			),
		);
	}

	update(actor: IntegrationActor, id: string, version: number, input: IntegrationInput): Promise<IntegrationRecord> {
		if (input.configuration.kind === 'acp' && input.credential.action !== 'clear') {
			throw new AgentFailure('invalid_input');
		}
		return this.task(id, () => this.model.update(actor, id, version, input, (facts) => this.admit(actor, facts)));
	}

	remove(actor: IntegrationActor, id: string, version: number): Promise<void> {
		return this.task(id, () => this.model.remove(actor, id, version, (facts) => this.admit(actor, facts)));
	}

	refresh(
		actor: IntegrationActor,
		id: string,
		version: number,
	): Promise<{ integration: IntegrationRecord; catalog: IntegrationDiscovery }> {
		return this.task(id, (signal) =>
			this.model.discover(actor, id, version, signal, (facts) => this.admit(actor, facts)),
		);
	}

	catalog(
		actor: { userId: number; appId: string },
		input: IntegrationCatalogInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		return this.task(input.id ?? actor.appId, async (deadline) => {
			const combined = AbortSignal.any([deadline, signal]);
			await validate();
			combined.throwIfAborted();
			if (input.id === null) {
				const records = await this.model.list({ userId: actor.userId, appId: actor.appId });
				await validate();
				combined.throwIfAborted();
				return JSON.stringify({
					integrations: records
						.filter((item) => item.configuration.kind === 'mcp')
						.map((item) => ({
							id: item.id,
							version: item.version,
							displayName: item.configuration.displayName,
							enabled: item.enabled,
						})),
					untrusted: true,
				});
			}
			const result = await this.model.catalog(actor, input.id, input.version, combined);
			await validate();
			combined.throwIfAborted();
			return JSON.stringify({
				integrationId: result.integration.id,
				version: result.integration.version,
				schemaHash: result.schemaHash,
				catalog: result.catalog,
				untrusted: true,
			});
		});
	}

	async acp(
		actor: { userId: number; appId: string },
		input: AcpIntegrationInvocation,
	): Promise<{ kind: 'acp'; connectionId: number; argv: string[]; cwd: string; prompt: string }> {
		const record = await this.model.get(actor, input.id);
		if (record.version !== input.version || !record.enabled || record.configuration.kind !== 'acp') {
			throw new AgentFailure('version_conflict');
		}
		return {
			kind: 'acp',
			connectionId: record.configuration.connectionId,
			argv: record.configuration.argv.map((arg) => arg),
			cwd: record.configuration.cwd,
			prompt: input.prompt,
		};
	}

	async validateVersion(actor: { userId: number; appId: string }, id: string, version: number): Promise<void> {
		const record = await this.model.get(actor, id);
		if (record.version !== version || !record.enabled) {
			throw new AgentFailure('version_conflict');
		}
	}

	invoke(
		actor: { userId: number; appId: string; runId: string },
		input: IntegrationInvocation,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		return this.task(input.id, async (deadline) => {
			for (const [key, pending] of this.inputs) {
				if (pending.expiresAt <= Date.now()) {
					this.inputs.delete(key);
				}
			}
			let remoteRequestState: string | null = null;
			if (input.resume !== null) {
				const state = input.resume.requestState;
				const pending = state === null ? undefined : this.inputs.get(state);
				if (
					!pending ||
					pending.userId !== actor.userId ||
					pending.appId !== actor.appId ||
					pending.runId !== actor.runId ||
					pending.id !== input.id ||
					pending.version !== input.version ||
					pending.schemaHash !== input.schemaHash ||
					pending.kind !== input.kind ||
					pending.name !== input.name ||
					pending.argumentsJson !== input.argumentsJson
				) {
					throw new AgentFailure('version_conflict');
				}
				// Consumption precedes remote dispatch; uncertainty cannot replay this response automatically.
				remoteRequestState = pending.remoteRequestState;
				this.inputs.delete(state ?? '');
			}
			if (this.inputs.size + this.inputReservations >= MAX_PENDING_INPUTS) {
				throw new AgentFailure('limit_exceeded');
			}
			// Reserve before dispatch: a remote effect must not fail local continuation admission afterwards.
			this.inputReservations++;
			try {
				const command: IntegrationInvocation = {
					id: input.id,
					version: input.version,
					schemaHash: input.schemaHash,
					kind: input.kind,
					name: input.name,
					argumentsJson: input.argumentsJson,
					resume:
						input.resume === null
							? null
							: { requestState: remoteRequestState, inputResponsesJson: input.resume.inputResponsesJson },
				};
				const combined = AbortSignal.any([signal, deadline]);
				const result = await this.model.invoke(actor, command, combined, validate, (record, catalog, hash) => {
					const found =
						input.kind === 'tool'
							? catalog.tools.some((item) => item.name === input.name)
							: input.kind === 'resource'
								? catalog.resources.some((item) => item.uri === input.name)
								: catalog.prompts.some((item) => item.name === input.name);
					if (!record.enabled || hash !== input.schemaHash || !found) {
						throw new AgentFailure('version_conflict');
					}
				});
				if (this.closing || combined.aborted) {
					throw input.kind === 'tool' ? new ToolExecutionUnknown() : new AgentFailure('provider_unavailable');
				}
				let requestState: string | null = null;
				if (result.kind === 'input_required') {
					requestState = randomUUID();
					this.inputs.set(requestState, {
						userId: actor.userId,
						appId: actor.appId,
						runId: actor.runId,
						id: input.id,
						version: input.version,
						schemaHash: input.schemaHash,
						kind: input.kind,
						name: input.name,
						argumentsJson: input.argumentsJson,
						requestState,
						remoteRequestState: result.requestState,
						expiresAt: Date.now() + PENDING_INPUT_TTL_MS,
					});
				}
				return result.kind === 'complete'
					? JSON.stringify({ kind: 'complete', resultJson: result.resultJson, untrusted: true })
					: JSON.stringify({
							kind: 'input_required',
							requestState,
							inputRequestsJson: result.inputRequestsJson,
							untrusted: true,
						});
			} finally {
				this.inputReservations--;
			}
		});
	}

	drainRun(owner: { userId: number; appId: string; runId: string }): void {
		for (const [key, value] of this.inputs) {
			if (value.userId === owner.userId && value.appId === owner.appId && value.runId === owner.runId) {
				this.inputs.delete(key);
			}
		}
	}

	quiesce(): void {
		this.closing = true;
		this.inputs.clear();
		this.stop.abort();
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled([...this.pending]);
			const released = await Promise.allSettled([this.model.close()]);
			const failures = this.failures.concat(
				released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
			);
			if (failures.length) {
				throw new AggregateError(failures, 'Integration drainage failed');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
