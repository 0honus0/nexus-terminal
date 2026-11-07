import { agentText, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_PLUGIN_MAX_ENTRY_BYTES } from './values.js';

/** Signed assets use the same archive path grammar as App, backend, and Skill entries. */
export function readAgentPluginPackageEntry(input: unknown, prefix: string): string | null {
	if (input === null) {
		return null;
	}
	const value = agentText(input, AGENT_PLUGIN_MAX_ENTRY_BYTES);
	if (
		!value.startsWith(prefix + '/') ||
		value.split('/').some((part) => part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}
