import { AGENT_SCOPE_MAX_NAME_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { randomUUID } from 'node:crypto';
import type { ScopeModel } from '../model/scope-model.js';
import type { AgentApp, AgentThread } from '../model/scope-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateUserId } from '../../agent-validation.js';

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES) {
		throw new AgentFailure('invalid_input');
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
