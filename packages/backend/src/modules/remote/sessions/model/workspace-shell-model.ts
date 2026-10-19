import { TerminalCleanupFailure } from '../../../../platform/terminal/terminal-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type {
	ShellIntegrationFactory,
	ShellIntegrationPort,
} from '../../../../platform/terminal/shell-integration-port.js';
import { WorkspaceFailure } from './workspace-types.js';

/** Converts application shell capabilities and failures at the technical boundary. */
export class WorkspaceShellModel {
	private readonly integration: ShellIntegrationPort;
	private promptListener: (() => void) | null = null;
	private ready = false;

	constructor(
		factory: ShellIntegrationFactory,
		write: (bytes: Uint8Array) => void,
		execute: (command: string, signal?: AbortSignal) => Promise<string>,
	) {
		this.integration = this.syncBoundary(() =>
			factory.create({
				write: (bytes) => write(Uint8Array.from(bytes)),

				execute: async (command, signal) => {
					try {
						return await execute(command, signal);
					} catch (error) {
						if (error instanceof RemoteResourceCleanupFailure) {
							throw new TerminalCleanupFailure([error]);
						}
						throw error;
					}
				},

				onPrompt: () => this.promptListener?.(),
			}),
		);
	}

	get isAtPrompt(): boolean {
		return this.syncBoundary(() => this.integration.isAtPrompt);
	}

	get isReady(): boolean {
		return this.ready;
	}

	onPrompt(listener: () => void): void {
		this.promptListener = listener;
	}

	private failure(cause: unknown): Error {
		if (cause instanceof TerminalCleanupFailure) {
			return new RemoteResourceCleanupFailure([cause]);
		}
		if (cause instanceof WorkspaceFailure || cause instanceof RemoteResourceCleanupFailure) {
			return cause;
		}
		return new WorkspaceFailure('remote_unavailable', { cause });
	}

	private syncBoundary<T>(operation: () => T): T {
		try {
			return operation();
		} catch (cause) {
			throw this.failure(cause);
		}
	}

	private async boundary<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			throw this.failure(cause);
		}
	}

	currentDirectory(signal?: AbortSignal): Promise<string> {
		return this.boundary(() => this.integration.currentDirectory(signal));
	}

	resolveDirectory(path: string, signal?: AbortSignal): Promise<string> {
		return this.boundary(() => this.integration.resolveDirectory(path, signal));
	}

	async ensureHook(): Promise<void> {
		await this.boundary(() => this.integration.ensureHook());
		this.ready = true;
	}

	changeDirectory(path: string): void {
		this.syncBoundary(() => this.integration.changeDirectory(path));
	}

	filterOutput(bytes: Uint8Array): Uint8Array {
		return this.syncBoundary(() => Uint8Array.from(this.integration.filterOutput(Uint8Array.from(bytes))));
	}

	noteUserInput(): void {
		this.syncBoundary(() => this.integration.noteUserInput());
	}

	onAttachmentReleased(): void {
		this.syncBoundary(() => this.integration.onAttachmentReleased());
	}

	close(): void {
		try {
			this.syncBoundary(() => this.integration.close());
		} finally {
			this.promptListener = null;
		}
	}
}

export class WorkspaceShellModelFactory {
	constructor(private readonly factory: ShellIntegrationFactory) {}

	create(
		write: (bytes: Uint8Array) => void,
		execute: (command: string, signal?: AbortSignal) => Promise<string>,
	): WorkspaceShellModel {
		return new WorkspaceShellModel(this.factory, write, execute);
	}
}
