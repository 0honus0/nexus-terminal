import type { AgentScopeStorage } from '../storage/scope-storage.js';

import type { AgentApp, AgentThread } from './scope-types.js';

export class ScopeModel {
	constructor(private readonly storage: AgentScopeStorage) {}

	async createApp(userId: number, id: string, name: string, createdAt: number): Promise<AgentApp> {
		const value = await this.storage.createApp({ id, userId, name, createdAt });
		return { id: value.id, name: value.name, createdAt: value.createdAt };
	}

	async createThread(
		userId: number,
		id: string,
		appId: string,
		title: string,
		createdAt: number,
	): Promise<AgentThread | null> {
		const value = await this.storage.createThread({ id, userId, appId, title, createdAt });
		return value === null
			? null
			: { id: value.id, appId: value.appId, title: value.title, createdAt: value.createdAt };
	}
}
