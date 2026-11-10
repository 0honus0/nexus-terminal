// Frozen published database migration dependency. Not an application API.
import { InvalidAgentPayload } from '../http-codec.js';

export function pluginContractText(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
		throw new InvalidAgentPayload();
	}
	return value;
}
