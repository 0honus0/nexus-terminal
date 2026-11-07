import type {
	AgentPluginModelRequest,
	AgentPluginModelResponse,
	AgentPluginModelSelection,
	AgentPluginModelDescriptor,
} from './app-runtime.js';
import type {
	AgentPluginRunInfo,
	AgentPluginCheckpoint,
	AgentPluginCheckpointWrite,
	AgentPluginRunHistory,
	AgentPluginTitleResult,
} from './run-context.js';
import type { AgentPluginContentReference, AgentPluginContentPage } from './content.js';
import type {
	AgentPluginBinding,
	AgentPluginDescription,
	AgentPluginDirectoryPage,
	AgentPluginInvocation,
	AgentPluginInvocationReply,
	AgentPluginRegistrationDefinition,
	AgentPluginInstanceEvent,
} from './registry.js';
import type { AgentPluginCallScope, AgentPluginRuntimeContext, AgentPluginRuntimeModule } from './runtime.js';
import type { AgentPluginHostOperationRequest, AgentPluginHostOperationResult } from './host-operations.js';
import type { AgentOperationErrorCode } from '../values.js';
import type {
	AgentPluginConfigurationWrite,
	AgentPluginInstanceSettings,
	AgentPluginInstanceView,
} from './settings.js';
import type {
	AgentPluginTransportSession,
	AgentPluginServiceTransportRequest,
	AgentPluginServiceTransportResult,
} from './service-transport.js';
import type { AgentPluginDataRecord, AgentPluginDataPage, AgentPluginDataWrite } from './data.js';

export interface AgentPluginDirectoryQuery {
	contract: string | null;
	apiVersion: number | null;
	kind: 'app' | 'tool' | 'service' | 'event' | null;
	cursor: string | null;
}

export interface AgentPluginCallContext {
	readonly identity: Readonly<AgentPluginRuntimeContext>;
	readonly scope: Readonly<AgentPluginCallScope>;
	readonly signal: AbortSignal;
	/** Pure local protocol/cache cleanup after Host closes managed I/O, including idle expiry. */
	onResourcesDispose(key: string, cleanup: () => void | Promise<void>): void;
	readonly directory: {
		discover(query: AgentPluginDirectoryQuery): Promise<AgentPluginDirectoryPage>;
		describe(entryId: string): Promise<AgentPluginDescription>;
		bind(entryId: string): Promise<AgentPluginBinding>;
		invoke(input: AgentPluginInvocation): Promise<AgentPluginInvocationReply>;
		/** Waits for an actual directory invalidation, with no periodic business reads. */
		wait(revision: number): Promise<number>;
	};
	/** Runtime contributions are bounded by the signed manifest and atomically published by Host. */
	contribute(
		definition: AgentPluginRegistrationDefinition,
		handler?: AgentPluginHandler,
	): Promise<() => Promise<void>>;
	/** Atomically replaces a named inventory. Changed definitions must use new keys; unchanged keys retain their handler. */
	replaceContributions(
		group: string,
		entries: { definition: AgentPluginRegistrationDefinition; handler?: AgentPluginHandler }[],
	): Promise<void>;
	readonly events: {
		emit(input: { key: string; cursor: string | null; payloadJson: string }): Promise<AgentPluginInstanceEvent>;
		wait(entryId: string, afterRevision: number): Promise<AgentPluginInstanceEvent>;
	};
	readonly content: {
		put(key: string, text: string, mediaType: string): Promise<AgentPluginContentReference>;
		read(reference: AgentPluginContentReference, index: number): Promise<AgentPluginContentPage>;
		text(reference: AgentPluginContentReference): Promise<string>;
	};
	readonly configuration: {
		/** Cold reads share the same owner as the human Settings page. */
		read(instanceId?: string): Promise<AgentPluginInstanceSettings>;
		list(): Promise<AgentPluginInstanceView[]>;
		/** A successful reply carries the durable effect receipt, including rejection or interruption. */
		write(instanceId: string, input: AgentPluginConfigurationWrite): Promise<AgentPluginInvocationReply>;
	};
	/** Own-instance data only. Keys are CAS revisions; null writes retain deletion tombstones. */
	readonly storage: {
		read(namespace: string, key: string): Promise<AgentPluginDataRecord | null>;
		list(namespace: string, after: string | null): Promise<AgentPluginDataPage>;
		write(input: AgentPluginDataWrite): Promise<AgentPluginInvocationReply>;
	};
	readonly models: {
		invoke(input: AgentPluginModelRequest): Promise<AgentPluginModelResponse>;
		describe(selection: AgentPluginModelSelection): Promise<AgentPluginModelDescriptor>;
	};
	readonly transport: {
		/** Sessions belong to this Run/provider/configuration, rather than the temporary handler scope. */
		open(operationKey: string): Promise<AgentPluginTransportSession>;
		/** Each call rechecks the current handler's authority; do not retain an old context between handlers. */
		call(sessionId: string, input: AgentPluginServiceTransportRequest): Promise<AgentPluginServiceTransportResult>;
		close(sessionId: string): Promise<void>;
	};
	readonly run: {
		describe(): Promise<AgentPluginRunInfo>;
		readCheckpoint(): Promise<AgentPluginCheckpoint | null>;
		checkpoint(input: AgentPluginCheckpointWrite): Promise<AgentPluginCheckpoint>;
		history(before: number | null): Promise<AgentPluginRunHistory>;
		append(input: { key: string; index: number; text: string }): Promise<void>;
		setTitle(input: {
			operationKey: string;
			expectedThreadVersion: number;
			title: string;
		}): Promise<AgentPluginTitleResult>;
	};
	perform(operationKey: string, input: AgentPluginHostOperationRequest): Promise<AgentPluginHostOperationResult>;
	request<T>(method: string, input: unknown, decode: (value: unknown) => T): Promise<T>;
}

export type AgentPluginHandler = (input: unknown, context: AgentPluginCallContext) => unknown | Promise<unknown>;

export interface AgentPluginSetup {
	readonly identity: Readonly<AgentPluginRuntimeContext>;
	register(definition: AgentPluginRegistrationDefinition, handler?: AgentPluginHandler): () => void;
	onDispose(cleanup: () => void | Promise<void>): void;
	/** Receives an instance management scope, with no model, App task or Run authority. */
	onReady(prepare: (context: AgentPluginCallContext) => void | Promise<void>): void;
}

export interface AgentPluginCapabilityFailure extends Error {
	readonly code: AgentOperationErrorCode;
}

/** Public types describe the standalone runtime asset, not Host implementation imports. */
export interface AgentPluginBackendModule {
	definePlugin(setup: (context: AgentPluginSetup) => void | Promise<void>): AgentPluginRuntimeModule;
	PluginCapabilityFailure: new (code: AgentOperationErrorCode) => AgentPluginCapabilityFailure;
}
