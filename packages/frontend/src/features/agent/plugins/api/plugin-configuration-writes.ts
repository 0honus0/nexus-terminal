import { registerAuthenticatedSessionReset } from '@/shared/session/authenticatedSessionLifecycle';
import { AgentManagementFailure } from '../../model/management-failure';
import type { PluginConfiguration, PluginConfigurationWrite } from '../model/plugin-instance-types';
import { writePluginConfiguration } from './plugin-instance-api';

interface PendingWrite {
	command: PluginConfigurationWrite;
	task: Promise<PluginConfiguration> | null;
}

/** An uncertain intent outlives its dialog; only its original key/request may be resubmitted. */
const pending = new Map<string, PendingWrite>();
let session = new AbortController();
registerAuthenticatedSessionReset('agent-plugin-configuration-writes', () => {
	session.abort();
	session = new AbortController();
	pending.clear();
});

function key(appId: string, instanceId: string): string {
	return JSON.stringify([appId, instanceId]);
}

export function pendingPluginConfiguration(appId: string, instanceId: string): PluginConfigurationWrite | null {
	const value = pending.get(key(appId, instanceId))?.command;
	return value
		? {
				operationKey: value.operationKey,
				expectedPackageRevision: value.expectedPackageRevision,
				expectedRevision: value.expectedRevision,
				schemaRevision: value.schemaRevision,
				documentJson: value.documentJson,
			}
		: null;
}

export function savePluginConfiguration(
	appId: string,
	instanceId: string,
	command: PluginConfigurationWrite,
	dispatch: (command: PluginConfigurationWrite, signal: AbortSignal) => Promise<PluginConfiguration> = (
		value,
		signal,
	) => writePluginConfiguration(appId, instanceId, value, signal),
): Promise<PluginConfiguration> {
	const id = key(appId, instanceId);
	let entry = pending.get(id);
	if (!entry) {
		entry = {
			command: {
				operationKey: command.operationKey,
				expectedPackageRevision: command.expectedPackageRevision,
				expectedRevision: command.expectedRevision,
				schemaRevision: command.schemaRevision,
				documentJson: command.documentJson,
			},
			task: null,
		};
		pending.set(id, entry);
	}
	if (
		entry.command.operationKey !== command.operationKey ||
		entry.command.expectedPackageRevision !== command.expectedPackageRevision ||
		entry.command.expectedRevision !== command.expectedRevision ||
		entry.command.schemaRevision !== command.schemaRevision ||
		entry.command.documentJson !== command.documentJson
	) {
		return Promise.reject(new AgentManagementFailure('idempotency_conflict', 'not_dispatched'));
	}
	if (entry.task) {
		return entry.task;
	}
	const original = entry;
	const request = session.signal;
	const task = Promise.resolve().then(() => dispatch(original.command, request));
	original.task = task;
	void task.then(
		() => {
			if (pending.get(id) === original) {
				pending.delete(id);
			}
		},
		(error: unknown) => {
			if (pending.get(id) !== original) {
				return;
			}
			if (error instanceof AgentManagementFailure && error.outcome !== 'unknown') {
				pending.delete(id);
			} else {
				original.task = null;
			}
		},
	);
	return task;
}
