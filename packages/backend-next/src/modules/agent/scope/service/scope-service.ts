import { randomUUID } from 'node:crypto';
import type { ScopeModel, AgentApp, AgentThread } from '../model/scope-model.js';
import { AgentOperationError, validateAgentId, validateUserId } from '../../agent-errors.js';

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 128) {
		throw new AgentOperationError('invalid_input');
	}
	return value.trim();
}

export class ScopeService {
	constructor(private readonly model: ScopeModel) {}

	createApp(userId: number, name: string): Promise<AgentApp> {
		validateUserId(userId);
		return this.model.createApp(userId, randomUUID(), validateName(name), Date.now());
	}

	createThread(userId: number, appId: string, title: string): Promise<AgentThread | null> {
		validateUserId(userId);
		validateAgentId(appId);
		return this.model.createThread(userId, randomUUID(), appId, validateName(title), Date.now());
	}
}
