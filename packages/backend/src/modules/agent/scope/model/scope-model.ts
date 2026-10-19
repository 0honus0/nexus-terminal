import { createHash } from 'node:crypto';
import type { AppInstallationFact, AppInstallationTask } from './scope-types.js';
import type { AgentScopeStorage, AppRecord, StoredDefinition } from '../storage/scope-storage.js';
import type { AgentApp, AgentThread, AppDefinition, CreateApp, AppStateTask } from './scope-types.js';
import { toStoredGrant } from '../../governance/model/governance-model.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import { fromThreadRecord } from './thread-mapper.js';

function fromApp(value: AppRecord): AgentApp {
	return {
		definitionInstalled: value.definitionInstalled,
		id: value.id,
		name: value.name,
		definitionId: value.definitionId,
		definitionVersion: value.definitionVersion,
		capabilities: value.capabilities.map((capability) => capability),
		enabled: value.enabled,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

/** Canonical storage fingerprint covers the complete declaration, including defaults. */
function definitionHash(definition: AppDefinition): string {
	const grants = definition.defaultGrants.map((grant) => {
		const scope = grant.scope;
		const ssh = scope.kind === 'targets' ? scope.targets.ssh : undefined;
		return {
			capability: grant.capability,
			scopeKind: scope.kind,
			sshMode: ssh?.mode ?? null,
			sshIds: ssh?.mode === 'ids' ? [...ssh.ids].sort() : [],
		};
	});
	grants.sort((a, b) => (a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0));
	return createHash('sha256')
		.update(
			JSON.stringify({
				id: definition.id,
				version: definition.version,
				displayName: definition.displayName,
				capabilities: [...definition.capabilities].sort(),
				defaultEnabled: definition.defaultEnabled,
				defaultGrants: grants,
			}),
		)
		.digest('hex');
}

export function toStoredDefinition(definition: AppDefinition): StoredDefinition {
	return {
		id: definition.id,
		version: definition.version,
		contentHash: definitionHash(definition),
		displayName: definition.displayName,
		capabilities: definition.capabilities.map((capability) => capability),
		defaultEnabled: definition.defaultEnabled,
	};
}

export class ScopeModel {
	constructor(private readonly storage: AgentScopeStorage) {}

	async declarations(userId: number, limit: number): Promise<import('./scope-types.js').AppDeclaration[]> {
		return (await agentStorage(() => this.storage.listDeclarations(userId, limit))).map((value) => ({
			id: value.id,
			version: value.version,
			displayName: value.displayName,
			capabilities: value.capabilities.map((item) => item),
			defaultEnabled: value.defaultEnabled,
		}));
	}

	install(
		definitions: readonly AppDefinition[],
		now: () => number,
		decide: (current: AppInstallationFact) => AppInstallationTask,
	): Promise<void> {
		return agentStorage(() =>
			this.storage.installDefinitions(definitions.map(toStoredDefinition), now, (current) => {
				const task = decide({
					definitionId: current.definitionId,
					definitionVersion: current.definitionVersion,
					enabled: current.enabled,
				});
				return {
					definitionVersion: task.definitionVersion,
					enabled: task.enabled,
					invalidate: task.invalidate,
				};
			}),
		);
	}

	async createApp(input: CreateApp): Promise<AgentApp> {
		const value = await agentStorage(() =>
			this.storage.createApp({
				id: input.id,
				userId: input.userId,
				name: input.name,
				definitionId: input.definition.id,
				definitionVersion: input.definition.version,
				enabled: input.definition.defaultEnabled,
				isDefault: input.isDefault,
				now: input.now,
				grants: input.definition.defaultGrants.map((grant) =>
					toStoredGrant(grant, Math.floor(input.now / 1000)),
				),
			}),
		);
		return fromApp(value);
	}

	async getApp(userId: number, id: string): Promise<AgentApp | null> {
		const value = await agentStorage(() => this.storage.getApp(userId, id));
		return value === null ? null : fromApp(value);
	}

	async listApps(userId: number, limit: number): Promise<AgentApp[]> {
		return (await agentStorage(() => this.storage.listApps(userId, limit))).map(fromApp);
	}

	async setEnabled(
		userId: number,
		id: string,
		version: number,
		now: () => number,
		decide: (current: AgentApp) => AppStateTask,
	): Promise<AgentApp | null> {
		const value = await agentStorage(() =>
			this.storage.setEnabled(userId, id, version, now, (stored) => {
				const task = decide(fromApp(stored));
				return { enabled: task.enabled, invalidate: task.invalidate };
			}),
		);
		if (value === 'not_found') {
			return null;
		}
		if (value === 'version_conflict') {
			throw new AgentFailure('version_conflict');
		}
		return fromApp(value);
	}

	async createThread(
		userId: number,
		id: string,
		appId: string,
		title: string,
		createdAt: number,
		admitCapacity: (threads: number) => void,
	): Promise<AgentThread | null> {
		const value = await agentStorage(() =>
			this.storage.createThread({ id, userId, appId, title, createdAt }, admitCapacity),
		);
		return value === null ? null : fromThreadRecord(value);
	}
}
