import type { AgentMemoryInvalidation } from '@nexus-terminal/shared/agent/memory/events';
import type { AgentStreamSource, AgentRunStreamEvent } from '@nexus-terminal/shared/agent/runs/events';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import { AgentFailure } from '../../agent-failure.js';

export interface AgentStreamSourceContext {
	identity: { userId: number; token: string };
	assertCurrent(): void;
	changed(): void;
	stopped(): void;
	revoked(): void;
}

export interface AgentStreamSourcePage {
	value: AgentRunStreamEvent | AgentRunEventsResponse | AgentMemoryInvalidation;
	more: boolean;
}

export interface AgentStreamSourceReader {
	/** Runtime source expiry, separate from transport liveness. */
	expiresAt: number | null;
	read(revision: number): Promise<AgentStreamSourcePage>;
	check(): Promise<void>;
	assertCurrent(): void;
	close(): void;
	requiresDrain(): boolean;
	nextPageBytes: number;
}

export interface AgentStreamSourceRegistration {
	kind: AgentStreamSource['kind'];
	open(source: AgentStreamSource, context: AgentStreamSourceContext): Promise<AgentStreamSourceReader>;
}

/** Registration narrows a named Shared source before handing it to its concrete owner. */
export function defineAgentStreamSource<K extends AgentStreamSource['kind']>(
	kind: K,
	accepts: (source: AgentStreamSource) => source is Extract<AgentStreamSource, { kind: K }>,
	open: (
		source: Extract<AgentStreamSource, { kind: K }>,
		context: AgentStreamSourceContext,
	) => Promise<AgentStreamSourceReader>,
): AgentStreamSourceRegistration {
	return {
		kind,

		open(source, context) {
			if (!accepts(source)) {
				throw new AgentFailure('invalid_input');
			}
			return open(source, context);
		},
	};
}

/** Only installed, typed sources can be opened; this registry does not publish arbitrary topics. */
export class AgentStreamSources {
	private readonly registrations = new Map<AgentStreamSource['kind'], AgentStreamSourceRegistration>();

	constructor(registrations: readonly AgentStreamSourceRegistration[]) {
		for (const registration of registrations) {
			if (this.registrations.has(registration.kind)) {
				throw new Error('Duplicate Agent stream source');
			}
			this.registrations.set(registration.kind, registration);
		}
	}

	open(source: AgentStreamSource, context: AgentStreamSourceContext): Promise<AgentStreamSourceReader> {
		const registration = this.registrations.get(source.kind);
		if (!registration) {
			return Promise.reject(new AgentFailure('not_found'));
		}
		return registration.open(source, context);
	}
}
