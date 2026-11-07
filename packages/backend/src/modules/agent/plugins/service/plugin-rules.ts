import { AgentFailure } from '../../agent-failure.js';
import type { PluginDataMutation, PluginData, PluginInstallation, PluginPublisher } from '../model/plugin-types.js';

export function decidePluginData(input: PluginDataMutation, current: PluginData | null): void {
	if (
		(current?.version ?? 0) !== input.expectedVersion ||
		(input.valueJson === null && (!current || current.valueJson === null))
	) {
		throw new AgentFailure('version_conflict');
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
