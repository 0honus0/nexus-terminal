import type { AgentScopeStorage, AppRecord } from '../storage/scope-storage.js';
import type { AgentApp, AgentThread, AppDeclaration, AppStateTask } from './scope-types.js';
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

export class ScopeModel {
	constructor(private readonly storage: AgentScopeStorage) {}

	async declarations(userId: number, limit: number): Promise<AppDeclaration[]> {
		return (await agentStorage(() => this.storage.listDeclarations(userId, limit))).map((value) => ({
			id: value.id,
			version: value.version,
			displayName: value.displayName,
			capabilities: value.capabilities.map((item) => item),
		}));
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
