export interface IsolatedModuleFile {
	path: string;
	bytes: Uint8Array;
	sha256: string;
}

export interface IsolatedModuleInstance {
	/** Actual process exit; file and host-task cleanup still belongs to close(). */
	readonly exited: Promise<void>;

	activate(): Promise<void>;
	health(): Promise<boolean>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

export interface ModuleRuntime {
	recover(): Promise<void>;
	open(input: {
		files: IsolatedModuleFile[];
		entry: string;
		contextJson: string;
		host(request: unknown): Promise<unknown>;
	}): Promise<IsolatedModuleInstance>;
}

export class ModuleRuntimeFailure extends Error {
	constructor(
		readonly kind: 'invalid_module' | 'unavailable' | 'protocol_invalid' | 'execution_unknown' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'ModuleRuntimeFailure';
	}
}
