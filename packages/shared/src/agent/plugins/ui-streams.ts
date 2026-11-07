import type { AgentRunStreamCursor, AgentRunStreamUpdate } from '../runs/events.js';
import type { AgentMemoryInvalidation } from '../memory/events.js';

export type AgentPluginUiStreamSource =
	{ kind: 'run'; runId: string; cursor: AgentRunStreamCursor } | { kind: 'memory'; threadId: string | null };

export type AgentPluginUiStreamRejection = 'forbidden' | 'resync_required' | 'unavailable' | 'protocol_failure';

export type AgentPluginUiStreamCommand =
	| { type: 'nexus.ui.stream.subscribe'; id: string; source: AgentPluginUiStreamSource }
	| { type: 'nexus.ui.stream.ack'; id: string; generation: number; revision: number; delivery: number }
	| { type: 'nexus.ui.stream.unsubscribe'; id: string };

export interface AgentPluginUiStreamPage {
	type: 'nexus.ui.stream.page';
	id: string;
	generation: number;
	revision: number;
	delivery: number;
	value: AgentRunStreamUpdate | AgentMemoryInvalidation;
}

export interface AgentPluginUiStreamFailure {
	type: 'nexus.ui.stream.failure';
	id: string;
	code: AgentPluginUiStreamRejection;
}

/** The consumer advances its durable source cursor only after applying the page. */
export interface AgentPluginUiStreamConsumer {
	source(): AgentPluginUiStreamSource;
	apply(value: unknown, revision: number): boolean;
	rejected(code: AgentPluginUiStreamRejection): void;
}

export interface AgentPluginUiStreamSubscription {
	resume(): void;
	close(): void;
	readonly closed: Promise<void>;
}
