import { AGENT_RUN_MAX_SELECTED_CONNECTIONS } from '@nexus-terminal/shared/agent/runs/values';

export function readRunSelection(input: unknown): number[] {
	if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > AGENT_RUN_MAX_SELECTED_CONNECTIONS * 20 + 2) {
		throw new Error('Corrupt Run target selection');
	}
	const value: unknown = JSON.parse(input);
	if (
		!Array.isArray(value) ||
		value.length > AGENT_RUN_MAX_SELECTED_CONNECTIONS ||
		new Set(value).size !== value.length
	) {
		throw new Error('Corrupt Run target selection');
	}
	return value.map((id: unknown) => {
		if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
			throw new Error('Corrupt Run target id');
		}
		return id;
	});
}
