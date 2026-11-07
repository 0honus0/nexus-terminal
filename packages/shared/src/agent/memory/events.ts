import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { AGENT_MEMORY_MAX_RESPONSE_BYTES } from './values.js';

export interface AgentMemoryInvalidation {
	type: 'memory-invalidated';
	epoch: string;
	revision: number;
}

export function readAgentMemoryInvalidation(input: unknown): AgentMemoryInvalidation {
	const row = agentRecord(input, ['type', 'epoch', 'revision'], AGENT_MEMORY_MAX_RESPONSE_BYTES);
	if (row.type !== 'memory-invalidated') {
		throw new InvalidAgentPayload();
	}
	return { type: 'memory-invalidated', epoch: readAgentId(row.epoch), revision: agentInteger(row.revision, 1) };
}
