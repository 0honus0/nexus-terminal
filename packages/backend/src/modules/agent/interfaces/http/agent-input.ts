import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRequest } from '../../../../platform/http/http-types.js';
import { AgentFailure } from '../../agent-failure.js';

/** Translate protocol decoding failures before they enter application operations. */
export class AgentHttpInput {
	constructor(private readonly request: HttpRequest) {}

	async normalize<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof InvalidAgentPayload) {
				throw new AgentFailure('invalid_input', { cause: error });
			}
			if (error instanceof AgentFailure) {
				throw error;
			}
			if (signal?.aborted && error instanceof Error && error.name === 'AbortError') {
				throw new AgentFailure('provider_unavailable', { cause: error });
			}
			throw error;
		}
	}

	read<T>(decode: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
		return this.normalize(async () => decode(this.request.body), signal);
	}
}
