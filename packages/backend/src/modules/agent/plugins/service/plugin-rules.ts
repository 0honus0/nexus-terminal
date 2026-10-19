import { AgentFailure } from '../../agent-failure.js';
import type { PluginDataMutation, PluginData, PluginInstallation, PluginPublisher } from '../model/plugin-types.js';

export function decidePluginData(
	input: PluginDataMutation,
	current: PluginData | null,
	keyCount: number,
	operationCount: number,
	dataBytes: number,
	operationBytes: number,
): void {
	if (
		(current?.version ?? 0) !== input.expectedVersion ||
		(input.valueJson === null && (!current || current.valueJson === null))
	) {
		throw new AgentFailure('version_conflict');
	}
	const bytes = input.valueJson === null ? 0 : Buffer.byteLength(input.valueJson, 'utf8');
	const replaced = current?.valueJson === null || current === null ? 0 : Buffer.byteLength(current.valueJson, 'utf8');
	if (
		(current === null && keyCount >= 1024) ||
		operationCount >= 4096 ||
		dataBytes - replaced + bytes > 8 * 1024 * 1024 ||
		operationBytes + bytes > 32 * 1024 * 1024
	) {
		throw new AgentFailure('limit_exceeded');
	}
}

export function authorizePluginContent(
	current: PluginInstallation,
	key: PluginPublisher | null,
	enabled: boolean,
): void {
	if (current.status !== 'installed' || !key || key.revokedAt !== null || !enabled) {
		throw new AgentFailure('forbidden');
	}
}
