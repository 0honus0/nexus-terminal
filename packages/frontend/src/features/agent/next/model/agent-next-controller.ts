import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunEventView, AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventType, AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentNextApi } from '../api/agent-next-api';

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

export interface AgentNextControllerState {
	busy: boolean;
	errorCode: string | null;
	unknownWrite: AgentNextUnknownWrite | null;
	app: AgentNextAppState | null;
	thread: AgentNextThreadState | null;
	run: AgentNextRunState | null;
	events: AgentNextEventState[];
	nextCursor: number;
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

const freshState = (): AgentNextControllerState => ({
	busy: false,
	errorCode: null,
	unknownWrite: null,
	app: null,
	thread: null,
	run: null,
	events: [],
	nextCursor: 0,
});

function codeOf(error: unknown): string {
	return error instanceof Error && error.message ? error.message : 'request_failed';
}

function unknownWriteResult(code: string): boolean {
	return (
		code === 'request_failed' ||
		code === 'protocol_failure' ||
		code === 'storage_unavailable' ||
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

	private fail(generation: number, controller: AbortController, error: unknown): string | null {
		if (!this.active(generation, controller)) return null;
		const code = codeOf(error);
		this.state.errorCode = code;
		return code;
	}

	private writeIntent(current: WriteIntent | null, signature: string): WriteIntent {
		return current?.signature === signature ? current : { signature, operationKey: crypto.randomUUID() };
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

	async createRun(appId: string, threadId: string, prompt: string): Promise<AgentNextRunState | null> {
		const signature = JSON.stringify([appId.toLowerCase(), threadId.toLowerCase(), prompt]);
		this.createRunIntent = this.writeIntent(this.createRunIntent, signature);
		const intent = this.createRunIntent;
		const { generation, controller } = this.begin();
		try {
			const result = await this.api.createRun(appId, threadId, prompt, intent.operationKey, controller.signal);
			if (!this.active(generation, controller)) return null;
			const run = toRunState(result.run);
			this.createRunIntent = null;
			this.state.unknownWrite = null;
			this.state.run = run;
			this.state.events = [];
			this.state.nextCursor = 0;
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
}
