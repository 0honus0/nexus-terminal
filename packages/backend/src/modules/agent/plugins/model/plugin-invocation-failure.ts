import { AgentFailure } from '../../agent-failure.js';

/** The isolation owner proved a source-only termination; actual cleanup is checked separately. */
export class PluginSourceInvocationFailure extends AgentFailure {
	constructor(options?: ErrorOptions) {
		super('provider_unavailable', options);
	}
}
