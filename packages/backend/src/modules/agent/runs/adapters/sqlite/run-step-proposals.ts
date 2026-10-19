import type { StoredStepProposal } from '../../storage/run-proposal-types.js';
import {
	TOOL_ARGUMENT_MAX_BYTES,
	TOOL_PROVIDER_CALL_ID_MAX_BYTES,
	TOOL_PROPOSAL_MAX_COUNT,
} from '../../run-tool-limits.js';
import { AGENT_APPROVAL_MAX_TOOL_NAME_BYTES } from '@nexus-terminal/shared/agent/governance/values';

/** The journal's private JSON is decoded only at its SQLite boundary. */
export function readStepProposals(input: unknown): StoredStepProposal[] {
	if (
		typeof input !== 'string' ||
		Buffer.byteLength(input, 'utf8') > TOOL_PROPOSAL_MAX_COUNT * (TOOL_ARGUMENT_MAX_BYTES * 6 + 1024)
	) {
		throw new Error('Corrupt model proposals capacity');
	}
	const value: unknown = JSON.parse(input);
	if (!Array.isArray(value) || value.length > TOOL_PROPOSAL_MAX_COUNT) {
		throw new Error('Corrupt model proposals');
	}
	const ids = new Set<string>();
	return value.map((item: unknown) => {
		if (
			!item ||
			typeof item !== 'object' ||
			Array.isArray(item) ||
			Object.keys(item).length !== 3 ||
			!('providerCallId' in item) ||
			!('toolName' in item) ||
			!('argumentsJson' in item) ||
			typeof item.providerCallId !== 'string' ||
			!item.providerCallId.trim() ||
			Buffer.byteLength(item.providerCallId, 'utf8') > TOOL_PROVIDER_CALL_ID_MAX_BYTES ||
			ids.has(item.providerCallId) ||
			typeof item.toolName !== 'string' ||
			!item.toolName.trim() ||
			Buffer.byteLength(item.toolName, 'utf8') > AGENT_APPROVAL_MAX_TOOL_NAME_BYTES ||
			typeof item.argumentsJson !== 'string' ||
			Buffer.byteLength(item.argumentsJson, 'utf8') > TOOL_ARGUMENT_MAX_BYTES
		) {
			throw new Error('Corrupt model proposal identity');
		}
		const args: unknown = JSON.parse(item.argumentsJson);
		if (!args || typeof args !== 'object' || Array.isArray(args)) {
			throw new Error('Corrupt model proposal arguments');
		}
		ids.add(item.providerCallId);
		return { providerCallId: item.providerCallId, toolName: item.toolName, argumentsJson: item.argumentsJson };
	});
}
