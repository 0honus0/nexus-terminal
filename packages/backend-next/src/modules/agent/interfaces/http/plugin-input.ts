import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { HttpRouteContext } from '../../../../platform/http/http-types.js';
import { AgentFailure } from '../../agent-failure.js';

/** Preserve transport status at the interface while the application observes an expected refusal. */
export class PluginHttpInput {
	transportFailure: HttpInputFailure | null = null;

	constructor(private readonly context: HttpRouteContext) {}

	async normalize<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof HttpInputFailure && error.status < 500) {
				this.transportFailure = error;
				throw new AgentFailure('invalid_input', { cause: error });
			}
			if (error instanceof InvalidAgentPayload) {
				throw new AgentFailure('invalid_input', { cause: error });
			}
			if (error instanceof AgentFailure) {
				throw error;
			}
			if (signal?.aborted) {
				throw new AgentFailure('provider_unavailable', { cause: error });
			}
			throw error;
		}
	}

	read<T>(decode: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
		return this.normalize(async () => decode(await this.context.json(signal)), signal);
	}
}
