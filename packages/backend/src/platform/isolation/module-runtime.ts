export interface IsolatedModuleFile {
	path: string;
	bytes: Uint8Array;
	sha256: string;
}

export interface IsolatedModuleInstance {
	/** Actual process exit; file and host-task cleanup still belongs to close(). */
	readonly exited: Promise<void>;

	activate(): Promise<unknown>;
	health(): Promise<boolean>;
	invoke(
		inputJson: string,
		signal: AbortSignal,
		timeoutMs: number,
		source?: IsolatedModuleSourceInvocation,
		host?: (request: unknown) => Promise<unknown>,
	): Promise<unknown>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

/** A Host-selected export and its invocation-local, read-only request bridge. */
export interface IsolatedModuleSourceInvocation {
	exportName: string;
	methods: readonly string[];
	/** The caller owns accepted read tasks and retains their failures, including caught refusals. */
	read(request: unknown): Promise<unknown>;
}

/** Expired ordinary requests must be refused without dispatching application effects. */
export type IsolatedModuleHostScope =
	{ kind: 'invoke'; controlId: number } | { kind: 'lifecycle' } | { kind: 'expired' };

export interface ModuleRuntime {
	recover(): Promise<void>;
	open(input: {
		files: IsolatedModuleFile[];
		entry: string;
		contextJson: string;
		host(request: unknown, scope: IsolatedModuleHostScope): Promise<unknown>;
	}): Promise<IsolatedModuleInstance>;
}

export class ModuleRuntimeFailure extends Error {
	constructor(
		readonly kind:
			| 'invalid_module'
			| 'unavailable'
			| 'protocol_invalid'
			| 'source_failed'
			| 'execution_unknown'
			| 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'ModuleRuntimeFailure';
	}
}

/** The exact ordinary invocation returned a negative control reply; its effects remain unclassified. */
export class ModuleInvocationFailure extends ModuleRuntimeFailure {
	constructor(readonly controlId: number) {
		super('execution_unknown');
	}
}
