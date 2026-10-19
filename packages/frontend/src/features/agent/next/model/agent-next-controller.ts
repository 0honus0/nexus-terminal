import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type {
	AgentRunEventView,
	AgentRunView,
	AgentRunStepView,
	AgentRunStepEventView,
} from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventType, AgentRunStatus, AgentRunStepState } from '@nexus-terminal/shared/agent/runs/values';
import { AgentNextFailure } from '../api/agent-next-api';
import type { AgentNextApi, AgentNextFailureCode } from '../api/agent-next-api';

export interface AgentNextUnknownWrite {
	kind: 'create_run' | 'cancel_run';
	operationKey: string;
}

export interface AgentNextAppState {
	id: string;
	name: string;
	createdAt: number;
}

export interface AgentNextThreadState {
	id: string;
	appId: string;
	title: string;
	createdAt: number;
}

export interface AgentNextRunState {
	id: string;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentNextEventState {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

export interface AgentNextAvailableModel {
	providerId: string;
	modelId: string;
	configurationVersion: number;
	displayName: string;
}

export interface AgentNextStepState {
	runId: string;
	stepIndex: number;
	state: AgentRunStepState;
	revision: number;
	runVersion: number;
	textBytes: number;
	finishReason?: import('@nexus-terminal/shared/agent/runs/values').AgentRunStepFinishReason;
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export type AgentNextStepEventState =
	| { runId: string; stepIndex: number; sequence: number; kind: 'text.delta'; textBytes: number; createdAt: number }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'usage';
			inputTokens: number;
			outputTokens: number;
			createdAt: number;
	  }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'step.completed' | 'step.failed' | 'step.unknown';
			createdAt: number;
	  };

export interface AgentNextModelSelection {
	providerId: string;
	modelId: string;
	configurationVersion: number;
}

export interface AgentNextControllerState {
	busy: boolean;
	errorCode: AgentNextFailureCode | null;
	unknownWrite: AgentNextUnknownWrite | null;
	app: AgentNextAppState | null;
	thread: AgentNextThreadState | null;
	run: AgentNextRunState | null;
	events: AgentNextEventState[];
	nextCursor: number;
	step: AgentNextStepState | null;
	stepEvents: AgentNextStepEventState[];
	stepCursor: number;
	availableModels: AgentNextAvailableModel[];
}

interface WriteIntent {
	signature: string;
	operationKey: string;
}

function toAppState(value: AgentAppView): AgentNextAppState {
	return { id: value.id, name: value.name, createdAt: value.createdAt };
}

function toThreadState(value: AgentThreadView): AgentNextThreadState {
	return { id: value.id, appId: value.appId, title: value.title, createdAt: value.createdAt };
}

function toRunState(value: AgentRunView): AgentNextRunState {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		status: value.status,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toEventState(value: AgentRunEventView): AgentNextEventState {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

function toStepState(value: AgentRunStepView): AgentNextStepState {
	return {
		runId: value.runId,
		stepIndex: value.stepIndex,
		state: value.state,
		revision: value.revision,
		runVersion: value.runVersion,
		textBytes: value.textBytes,
		...(value.finishReason === undefined ? {} : { finishReason: value.finishReason }),
		...(value.inputTokens === undefined
			? {}
			: { inputTokens: value.inputTokens, outputTokens: value.outputTokens }),
		...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toStepEventState(value: AgentRunStepEventView): AgentNextStepEventState {
	const identity = {
		runId: value.runId,
		stepIndex: value.stepIndex,
		sequence: value.sequence,
		createdAt: value.createdAt,
	};
	if (value.kind === 'text.delta') {
		return { ...identity, kind: value.kind, textBytes: value.textBytes };
	}
	if (value.kind === 'usage') {
		return { ...identity, kind: value.kind, inputTokens: value.inputTokens, outputTokens: value.outputTokens };
	}
	return { ...identity, kind: value.kind };
}

const freshState = (): AgentNextControllerState => ({
	busy: false,
	errorCode: null,
	unknownWrite: null,
	app: null,
	thread: null,
	run: null,
	events: [],
	nextCursor: 0,
	step: null,
	stepEvents: [],
	stepCursor: 0,
	availableModels: [],
});

function codeOf(error: unknown): AgentNextFailureCode {
	return error instanceof AgentNextFailure ? error.code : 'request_failed';
}

function unknownWriteResult(code: AgentNextFailureCode): boolean {
	return (
		code === 'request_failed' ||
		code === 'protocol_failure' ||
		code === 'storage_unavailable' ||
		code === 'operation_unknown' ||
		code === 'internal_failure'
	);
}

export class AgentNextController {
	private state = freshState();
	private generation = 0;
	private request: AbortController | null = null;
	private createRunIntent: WriteIntent | null = null;
	private cancelRunIntent: WriteIntent | null = null;

	constructor(
		private readonly api: AgentNextApi,
		private readonly publish: (state: AgentNextControllerState) => void,
	) {
		this.emit();
	}

	snapshot(): AgentNextControllerState {
		return {
			...this.state,
			events: [...this.state.events],
			step: this.state.step ? { ...this.state.step } : null,
			stepEvents: [...this.state.stepEvents],
			availableModels: this.state.availableModels.map((model) => ({ ...model })),
			unknownWrite: this.state.unknownWrite ? { ...this.state.unknownWrite } : null,
		};
	}

	invalidatePending(): void {
		this.generation += 1;
		this.request?.abort();
		this.request = null;
		if (this.state.busy) {
			this.state.busy = false;
			this.emit();
		}
	}

	resetRunSelection(): void {
		this.invalidatePending();
		this.state.run = null;
		this.state.events = [];
		this.state.nextCursor = 0;
		this.clearStepAudit();
		this.state.errorCode = null;
		this.emit();
	}

	reset(): void {
		this.generation += 1;
		this.request?.abort();
		this.request = null;
		this.createRunIntent = null;
		this.cancelRunIntent = null;
		this.state = freshState();
		this.emit();
	}

	dispose(): void {
		this.reset();
	}

	private emit(): void {
		this.publish(this.snapshot());
	}

	private clearStepAudit(): void {
		this.state.step = null;
		this.state.stepEvents = [];
		this.state.stepCursor = 0;
	}

	private requireSelectedRun(appId: string, runId: string): boolean {
		if (this.state.run?.appId === appId.toLowerCase() && this.state.run.id === runId.toLowerCase()) {
			return true;
		}
		this.state.errorCode = 'invalid_input';
		this.emit();
		return false;
	}

	private begin(): { generation: number; controller: AbortController } {
		this.generation += 1;
		this.request?.abort();
		const controller = new AbortController();
		this.request = controller;
		this.state.busy = true;
		this.state.errorCode = null;
		this.emit();
		return { generation: this.generation, controller };
	}

	private active(generation: number, controller: AbortController): boolean {
		return generation === this.generation && this.request === controller && !controller.signal.aborted;
	}

	private finish(generation: number, controller: AbortController): void {
		if (!this.active(generation, controller)) return;
		this.state.busy = false;
		this.request = null;
		this.emit();
	}

	private fail(generation: number, controller: AbortController, error: unknown): AgentNextFailureCode | null {
		if (!this.active(generation, controller)) return null;
		const code = codeOf(error);
		this.state.errorCode = code;
		return code;
	}

	private writeIntent(current: WriteIntent | null, signature: string): WriteIntent {
		return current?.signature === signature ? current : { signature, operationKey: crypto.randomUUID() };
	}

	async loadModels(): Promise<boolean> {
		const { generation, controller } = this.begin();
		try {
			const providers = await this.api.listProviders(controller.signal);
			if (!this.active(generation, controller)) return false;
			this.state.availableModels = providers
				.filter((provider) => provider.enabled)
				.flatMap((provider) =>
					provider.models.map((model) => ({
						providerId: provider.id,
						modelId: model.id,
						configurationVersion: provider.version,
						displayName: provider.displayName,
					})),
				);
			return true;
		} catch (error) {
			this.fail(generation, controller, error);
			return false;
		} finally {
			this.finish(generation, controller);
		}
	}

	async createApp(name: string): Promise<AgentNextAppState | null> {
		const { generation, controller } = this.begin();
		try {
			const app = toAppState(await this.api.createApp(name, controller.signal));
			if (!this.active(generation, controller)) return null;
			this.state.app = app;
			return app;
		} catch (error) {
			this.fail(generation, controller, error);
			return null;
		} finally {
			this.finish(generation, controller);
		}
	}

	async createThread(appId: string, title: string): Promise<AgentNextThreadState | null> {
		const { generation, controller } = this.begin();
		try {
			const thread = toThreadState(await this.api.createThread(appId, title, controller.signal));
			if (!this.active(generation, controller)) return null;
			this.state.thread = thread;
			return thread;
		} catch (error) {
			this.fail(generation, controller, error);
			return null;
		} finally {
			this.finish(generation, controller);
		}
	}

	async createRun(
		appId: string,
		threadId: string,
		prompt: string,
		model: AgentNextModelSelection,
	): Promise<AgentNextRunState | null> {
		const signature = JSON.stringify([
			appId.toLowerCase(),
			threadId.toLowerCase(),
			prompt,
			model.providerId.toLowerCase(),
			model.modelId,
			model.configurationVersion,
		]);
		this.createRunIntent = this.writeIntent(this.createRunIntent, signature);
		const intent = this.createRunIntent;
		const { generation, controller } = this.begin();
		try {
			const result = await this.api.createRun(
				appId,
				threadId,
				prompt,
				{
					providerId: model.providerId,
					modelId: model.modelId,
					configurationVersion: model.configurationVersion,
				},
				intent.operationKey,
				controller.signal,
			);
			if (!this.active(generation, controller)) return null;
			const run = toRunState(result.run);
			this.createRunIntent = null;
			this.state.unknownWrite = null;
			this.state.run = run;
			this.state.events = [];
			this.state.nextCursor = 0;
			this.clearStepAudit();
			return run;
		} catch (error) {
			const code = this.fail(generation, controller, error);
			if (code !== null && this.active(generation, controller)) {
				if (unknownWriteResult(code)) {
					this.state.unknownWrite = { kind: 'create_run', operationKey: intent.operationKey };
				} else {
					this.createRunIntent = null;
					this.state.unknownWrite = null;
				}
			}
			return null;
		} finally {
			this.finish(generation, controller);
		}
	}

	async cancelRun(appId: string, runId: string, expectedVersion: number): Promise<AgentNextRunState | null> {
		const signature = JSON.stringify([appId.toLowerCase(), runId.toLowerCase(), expectedVersion]);
		this.cancelRunIntent = this.writeIntent(this.cancelRunIntent, signature);
		const intent = this.cancelRunIntent;
		const { generation, controller } = this.begin();
		try {
			const result = await this.api.cancelRun(
				appId,
				runId,
				expectedVersion,
				intent.operationKey,
				controller.signal,
			);
			if (!this.active(generation, controller)) return null;
			const run = toRunState(result.run);
			this.cancelRunIntent = null;
			this.state.unknownWrite = null;
			this.state.run = run;
			return run;
		} catch (error) {
			const code = this.fail(generation, controller, error);
			if (code === null || !this.active(generation, controller)) return null;
			if (unknownWriteResult(code)) {
				this.state.unknownWrite = { kind: 'cancel_run', operationKey: intent.operationKey };
			} else {
				this.cancelRunIntent = null;
				this.state.unknownWrite = null;
			}
			if (code === 'version_conflict') {
				try {
					const fresh = toRunState(await this.api.getRun(appId, runId, controller.signal));
					if (this.active(generation, controller)) this.state.run = fresh;
				} catch {
					// The conflict remains authoritative; refresh failure never retries the cancel.
				}
			}
			return null;
		} finally {
			this.finish(generation, controller);
		}
	}

	async getRun(appId: string, runId: string): Promise<AgentNextRunState | null> {
		const { generation, controller } = this.begin();
		try {
			const run = toRunState(await this.api.getRun(appId, runId, controller.signal));
			if (!this.active(generation, controller)) return null;
			const changed = this.state.run?.id !== run.id || this.state.run?.appId !== run.appId;
			this.state.run = run;
			if (changed) {
				this.state.events = [];
				this.state.nextCursor = 0;
				this.clearStepAudit();
			}
			return run;
		} catch (error) {
			this.fail(generation, controller, error);
			return null;
		} finally {
			this.finish(generation, controller);
		}
	}

	async listEvents(appId: string, runId: string, limit = 50): Promise<boolean> {
		if (!this.requireSelectedRun(appId, runId)) return false;
		const { generation, controller } = this.begin();
		try {
			const page = await this.api.listEvents(appId, runId, this.state.nextCursor, limit, controller.signal);
			if (!this.active(generation, controller)) return false;
			const merged = new Map(this.state.events.map((item) => [`${item.runId}:${item.sequence}`, item]));
			for (const wireItem of page.items) {
				const item = toEventState(wireItem);
				merged.set(`${item.runId}:${item.sequence}`, item);
			}
			this.state.events = [...merged.values()].sort((left, right) => left.sequence - right.sequence);
			this.state.nextCursor = page.nextCursor;
			return true;
		} catch (error) {
			this.fail(generation, controller, error);
			return false;
		} finally {
			this.finish(generation, controller);
		}
	}

	async getStep(appId: string, runId: string): Promise<boolean> {
		if (!this.requireSelectedRun(appId, runId)) return false;
		const { generation, controller } = this.begin();
		try {
			const step = await this.api.getStep(appId, runId, controller.signal);
			if (!this.active(generation, controller)) return false;
			this.state.step = toStepState(step);
			return true;
		} catch (error) {
			if (
				this.active(generation, controller) &&
				codeOf(error) === 'not_found' &&
				this.state.run?.id === runId.toLowerCase() &&
				this.state.run.appId === appId.toLowerCase()
			) {
				this.clearStepAudit();
				return true; // No authorized execution step is expected for a pending Run.
			}
			this.fail(generation, controller, error);
			return false;
		} finally {
			this.finish(generation, controller);
		}
	}

	async listStepEvents(appId: string, runId: string, limit = 50): Promise<boolean> {
		if (!this.requireSelectedRun(appId, runId)) return false;
		const { generation, controller } = this.begin();
		try {
			const page = await this.api.listStepEvents(appId, runId, this.state.stepCursor, limit, controller.signal);
			if (!this.active(generation, controller)) return false;
			const merged = new Map(this.state.stepEvents.map((item) => [item.sequence, item]));
			for (const event of page.items) merged.set(event.sequence, toStepEventState(event));
			this.state.stepEvents = [...merged.values()].sort((a, b) => a.sequence - b.sequence);
			this.state.stepCursor = page.nextCursor;
			return true;
		} catch (error) {
			this.fail(generation, controller, error);
			return false;
		} finally {
			this.finish(generation, controller);
		}
	}
}
