import { agentInteger, agentRecord, InvalidAgentPayload } from '../http-codec.js';
import { readAgentPluginContentReference } from './content.js';
import type { AgentPluginContentReference } from './content.js';

/** Completion does not require text, a model exchange, or a fabricated file. */
export interface AgentPluginAppComplete {
	kind: 'complete';
	outputs: AgentPluginContentReference[];
}

export type AgentPluginAppOutcome =
	| AgentPluginAppComplete
	| {
			kind: 'suspend';
			checkpointVersion: number;
			inputRequest: AgentPluginContentReference;
	  };

export function readAgentPluginAppOutcome(input: unknown): AgentPluginAppOutcome {
	if (input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'suspend') {
		const row = agentRecord(input, ['kind', 'checkpointVersion', 'inputRequest']);
		return {
			kind: 'suspend',
			checkpointVersion: agentInteger(row.checkpointVersion, 1),
			inputRequest: readAgentPluginContentReference(row.inputRequest),
		};
	}
	const row = agentRecord(input, ['kind', 'outputs']);
	if (row.kind !== 'complete' || !Array.isArray(row.outputs)) {
		throw new InvalidAgentPayload();
	}
	const outputs = row.outputs.map(readAgentPluginContentReference);
	if (new Set(outputs.map((item) => item.id)).size !== outputs.length) {
		throw new InvalidAgentPayload();
	}
	return { kind: 'complete', outputs };
}
