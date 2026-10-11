export interface ShellIntegrationOptions {
	write(bytes: Uint8Array): void;
	execute(command: string, signal?: AbortSignal): Promise<string>;
	onPrompt(): void;
}

export interface ShellIntegrationPort {
	readonly isAtPrompt: boolean;
	currentDirectory(signal?: AbortSignal): Promise<string>;
	resolveDirectory(path: string, signal?: AbortSignal): Promise<string>;
	ensureHook(): Promise<void>;
	changeDirectory(path: string): void;
	filterOutput(bytes: Uint8Array): Uint8Array;
	noteUserInput(): void;
	onAttachmentReleased(): void;
	close(): void;
}

export interface ShellIntegrationFactory {
	create(options: ShellIntegrationOptions): ShellIntegrationPort;
}
