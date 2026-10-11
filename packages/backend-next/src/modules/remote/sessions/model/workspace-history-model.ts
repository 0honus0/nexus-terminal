import type {
	SuspendedTerminalLogPort,
	SuspendedTerminalLogSlice,
	TerminalLogRenderer,
} from '../../../../platform/terminal/suspended-log-port.js';
import type { SuspendedCheckpointFactory } from '../../../../platform/terminal/suspended-checkpoint-port.js';
import { TerminalCleanupFailure } from '../../../../platform/terminal/terminal-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	WorkspaceFailure,
	type WorkspaceCheckpoint,
	type WorkspaceLogSource,
	type WorkspaceHistoryPage,
	type WorkspaceViewport,
} from './workspace-types.js';

function viewport(value: WorkspaceViewport): WorkspaceViewport {
	return { columns: value.columns, rows: value.rows };
}

function fromLogSlice(value: SuspendedTerminalLogSlice): WorkspaceHistoryPage {
	return {
		data: Uint8Array.from(value.data),
		startOffset: value.startOffset,
		endOffset: value.endOffset,
		totalBytes: value.totalBytes,
		oldestOffset: value.oldestOffset,
	};
}

export class WorkspaceHistoryModel {
	constructor(
		private readonly logs: SuspendedTerminalLogPort,
		private readonly checkpoints: SuspendedCheckpointFactory,
		private readonly renderer: TerminalLogRenderer,
	) {}

	private async boundary<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			if (cause instanceof TerminalCleanupFailure) {
				throw new RemoteResourceCleanupFailure([cause]);
			}
			if (cause instanceof RemoteResourceCleanupFailure || cause instanceof WorkspaceFailure) {
				throw cause;
			}
			throw new WorkspaceFailure('remote_unavailable', { cause });
		}
	}

	append(id: string, bytes: Uint8Array): Promise<number> {
		return this.boundary(() => this.logs.append(id, Uint8Array.from(bytes)));
	}

	position(id: string): Promise<number> {
		return this.boundary(() => this.logs.position(id));
	}

	async readTail(id: string, maxBytes: number): Promise<WorkspaceHistoryPage> {
		const result = await this.boundary(() => this.logs.readTail(id, maxBytes));
		return fromLogSlice(result);
	}

	async readBefore(id: string, offset: number, maxBytes: number): Promise<WorkspaceHistoryPage> {
		const result = await this.boundary(() => this.logs.readBefore(id, offset, maxBytes));
		return fromLogSlice(result);
	}

	delete(id: string): Promise<void> {
		return this.boundary(async () => {
			try {
				await this.logs.delete(id);
			} catch (cause) {
				throw new RemoteResourceCleanupFailure([cause]);
			}
		});
	}

	createCheckpoint(initial: string | undefined, view: WorkspaceViewport): WorkspaceCheckpoint {
		const resource = this.checkpoints.create(initial, viewport(view));
		return {
			write: (data) =>
				this.boundary(() => resource.write(typeof data === 'string' ? data : Uint8Array.from(data))),

			resize: (view) => this.boundary(() => resource.resize(viewport(view))),

			reset: (data, view) => this.boundary(() => resource.reset(data, viewport(view))),

			snapshot: () =>
				this.boundary(async () => {
					const value = await resource.snapshot();
					return { data: value.data, columns: value.columns, rows: value.rows };
				}),

			dispose: () => this.boundary(() => resource.dispose()),
		};
	}

	async openText(id: string, view: WorkspaceViewport, signal: AbortSignal): Promise<WorkspaceLogSource> {
		return this.boundary(async () => {
			const source = await this.logs.openRead(id);
			const result = await this.renderer.render(source, viewport(view), signal);

			const boundary = <T>(operation: () => Promise<T>) => this.boundary(operation);

			return {
				bytes: (async function* () {
					const iterator = result.bytes[Symbol.asyncIterator]();
					try {
						while (true) {
							const next = await boundary(() => iterator.next());
							if (next.done) {
								return;
							}
							yield Uint8Array.from(next.value);
						}
					} finally {
						const finish = iterator.return?.bind(iterator);
						if (finish) {
							await boundary(() => finish());
						}
					}
				})(),

				release: () => this.boundary(() => result.release()),
			};
		});
	}
}
