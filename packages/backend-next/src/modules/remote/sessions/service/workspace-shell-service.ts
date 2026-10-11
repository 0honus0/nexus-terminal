import { WorkspaceFailure } from '../model/workspace-types.js';
import type { WorkspaceShellModel } from '../model/workspace-shell-model.js';
import type { WorkspaceDirectoryEvent } from '../model/workspace-types.js';
interface DirectoryChange {
	requestId: string;
	path: string;
	expectedPath: string;
	sent: boolean;
	isCurrent(): boolean;
	timer: ReturnType<typeof setTimeout>;
}

const DIRECTORY_TIMEOUT_MS = 10 * 60_000;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export class WorkspaceShellService {
	private pending: DirectoryChange | null = null;
	private closed = false;

	constructor(
		private readonly model: WorkspaceShellModel,
		private readonly publish: (event: WorkspaceDirectoryEvent) => void,
	) {
		model.onPrompt(() => this.handlePrompt());
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new WorkspaceFailure('remote_unavailable');
		}
	}

	async changeDirectory(
		requestId: string,
		requested: string,
		signal?: AbortSignal,
		isCurrent: () => boolean = () => true,
	): Promise<void> {
		this.assertOpen();
		if (!requestId || !requested.startsWith('/') || CONTROL.test(requested)) {
			throw new WorkspaceFailure('invalid_input');
		}
		// Validation and hook installation may await, but the caller must re-check its
		// attachment after await; the model never writes a stale request on its own.
		const expectedPath = await this.model.resolveDirectory(requested, signal);
		if (!isCurrent()) {
			throw new WorkspaceFailure('not_found');
		}
		await this.model.ensureHook();
		this.assertOpen();
		if (!isCurrent()) {
			throw new WorkspaceFailure('not_found');
		}
		if (!this.model.isReady) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (this.pending) {
			const previous = this.pending;
			clearTimeout(previous.timer);
			this.publish({ type: 'failed', requestId: previous.requestId, message: 'Replaced by a newer change' });
		}
		const pending: DirectoryChange = {
			requestId,
			path: requested,
			expectedPath,
			sent: false,
			isCurrent,
			timer: setTimeout(() => {
				if (this.pending !== pending) {
					return;
				}
				this.pending = null;
				this.publish({ type: 'failed', requestId, message: 'Waiting for shell prompt timed out' });
			}, DIRECTORY_TIMEOUT_MS),
		};
		pending.timer.unref();
		this.pending = pending;
		this.publish({ type: 'queued', requestId, path: requested, waitingForPrompt: !this.model.isAtPrompt });
		if (this.model.isAtPrompt) {
			this.handlePrompt();
		}
	}

	private handlePrompt(): void {
		const pending = this.pending;
		if (!pending) {
			return;
		}
		if (!pending.isCurrent()) {
			this.failDirectory(pending, new Error('Workspace attachment changed'));
			return;
		}
		if (!pending.sent) {
			pending.sent = true;
			try {
				this.model.changeDirectory(pending.path);
			} catch (error) {
				this.failDirectory(pending, error);
			}
			return;
		}
		clearTimeout(pending.timer);
		this.pending = null;
		void this.model.currentDirectory().then(
			(value) => {
				if (pending.isCurrent() && !this.closed) {
					this.publish(
						value === pending.expectedPath
							? { type: 'changed', requestId: pending.requestId, path: value }
							: {
									type: 'failed',
									requestId: pending.requestId,
									message: 'Shell directory did not change',
								},
					);
				}
			},
			() => {
				if (pending.isCurrent() && !this.closed) {
					this.publish({
						type: 'failed',
						requestId: pending.requestId,
						message: 'Unable to verify directory',
					});
				}
			},
		);
	}

	private failDirectory(pending: DirectoryChange, _error: unknown): void {
		if (this.pending !== pending) {
			return;
		}
		clearTimeout(pending.timer);
		this.pending = null;
		this.publish({
			type: 'failed',
			requestId: pending.requestId,
			message: 'Directory change failed',
		});
	}

	currentDirectory(signal?: AbortSignal): Promise<string> {
		return this.model.currentDirectory(signal);
	}

	filterOutput(bytes: Uint8Array): Uint8Array {
		return this.model.filterOutput(bytes);
	}

	noteUserInput(): void {
		this.model.noteUserInput();
	}

	onAttachmentReleased(): void {
		if (this.pending) {
			clearTimeout(this.pending.timer);
			this.pending = null;
		}
		this.model.onAttachmentReleased();
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		if (this.pending) {
			this.failDirectory(this.pending, new Error('Shell closed'));
		}
		this.model.close();
	}
}
