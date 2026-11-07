import type { AgentPluginFrontendInput, AgentPluginFrontendResult } from './frontend-events.js';
import type { AgentRunEventsResponse } from '../runs/http.js';
import type {
	AgentPluginUiEnvironment,
	AgentPluginUiHostInput,
	AgentPluginUiHostResult,
	AgentPluginUiHostFailure,
} from './ui-events.js';
import type { AgentPluginUiStreamConsumer, AgentPluginUiStreamSubscription } from './ui-streams.js';
import type {
	AgentPluginConfigurationView,
	AgentPluginConfigurationWrite,
	AgentPluginInstanceSettings,
} from './settings.js';

export interface AgentPluginRunSubscription {
	id: string;
	closed: Promise<void>;
}

export interface AgentPluginFrontendSdk {
	protocolVersion: 4;
	readonly ui: {
		readonly ready: Promise<AgentPluginUiEnvironment>;
		readonly environment: AgentPluginUiEnvironment | null;
		onEnvironment(listener: (environment: AgentPluginUiEnvironment) => void): () => void;
		onTaskOpen(listener: (runId: string) => void): () => void;
		onClose(listener: () => void): () => void;
		request(input: AgentPluginUiHostInput, signal?: AbortSignal, file?: File): Promise<AgentPluginUiHostResult>;
		streams: { subscribe(consumer: AgentPluginUiStreamConsumer): AgentPluginUiStreamSubscription };
	};
	request(input: AgentPluginFrontendInput, signal?: AbortSignal): Promise<AgentPluginFrontendResult>;
	/** Bound to this Settings Surface's original logical instance; it cannot choose another instance. */
	readonly settings: {
		read(signal?: AbortSignal): Promise<AgentPluginInstanceSettings>;
		write(input: AgentPluginConfigurationWrite, signal?: AbortSignal): Promise<AgentPluginConfigurationView>;
	};
	agent: {
		runs: {
			subscribe(
				runId: string,
				after: number,
				onEvents: (page: AgentRunEventsResponse) => void | Promise<void>,
				onFailure: (error: Error) => void | Promise<void>,
			): AgentPluginRunSubscription;
			unsubscribe(id: string): Promise<void>;
		};
	};
	close(): Promise<void>;
}

export interface AgentPluginUiRequestFailure extends Error {
	readonly code: AgentPluginUiHostFailure['code'];
	readonly outcome: AgentPluginUiHostFailure['outcome'];
}

export interface AgentPluginUiRequestFailureConstructor {
	new (
		code: AgentPluginUiRequestFailure['code'],
		outcome: AgentPluginUiRequestFailure['outcome'],
	): AgentPluginUiRequestFailure;
}

/** Exports of the Host's public /sdk/frontend-v4.mjs browser module. */
export interface AgentPluginFrontendModule {
	connectNexusPlugin(): Promise<AgentPluginFrontendSdk>;
	readonly PluginUiRequestFailure: AgentPluginUiRequestFailureConstructor;
}
