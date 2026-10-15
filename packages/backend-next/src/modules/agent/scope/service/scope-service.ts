import type { RevokeRuns } from '../../runs/model/run-types.js';
import { DEFAULT_APP_DEFINITION_ID, validateAppDefinitions } from './app-definitions.js';
import { AGENT_SCOPE_MAX_NAME_BYTES, AGENT_APP_MAX_LIST_ITEMS } from '@nexus-terminal/shared/agent/scope/values';
import { randomUUID } from 'node:crypto';
import type { ScopeModel } from '../model/scope-model.js';
import type { AgentApp, AgentThread, AppDefinition, AppDeclaration } from '../model/scope-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateUserId } from '../../agent-validation.js';

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES) {
		throw new AgentFailure('invalid_input');
	}
	return value.trim();
}

export class ScopeService {
	constructor(
		private readonly model: ScopeModel,
		private readonly registeredDefinitions: readonly AppDefinition[],
		private readonly revoke: RevokeRuns,
		private readonly activateRuntime: (userId: number, appId: string) => Promise<void>,
	) {
		validateAppDefinitions(registeredDefinitions);
	}

	initialize(): Promise<void> {
		return this.model.install(this.registeredDefinitions, Date.now, (current) => {
			const definition =
				this.registeredDefinitions.find((definition) => definition.id === current.definitionId) ?? null;
			const definitionVersion = definition === null ? current.definitionVersion : definition.version;
			const enabled = definition !== null && current.enabled;
			return {
				definitionVersion,
				enabled,
				invalidate: definitionVersion !== current.definitionVersion || enabled !== current.enabled,
			};
		});
	}

	definitions(): AppDeclaration[] {
		return this.registeredDefinitions.map((definition) => ({
			id: definition.id,
			version: definition.version,
			displayName: definition.displayName,
			capabilities: definition.capabilities.map((capability) => capability),
			defaultEnabled: definition.defaultEnabled,
		}));
	}

	async declarations(userId: number): Promise<AppDeclaration[]> {
		validateUserId(userId);
		const values = await this.model.declarations(userId, AGENT_APP_MAX_LIST_ITEMS + 1);
		if (values.length > AGENT_APP_MAX_LIST_ITEMS) {
			throw new AgentFailure('limit_exceeded');
		}
		return values;
	}

	async initializeDefaults(userId: number): Promise<void> {
		validateUserId(userId);
		for (const definition of this.registeredDefinitions) {
			await this.model.createApp({
				id: randomUUID(),
				userId,
				name: definition.displayName,
				definition,
				isDefault: true,
				now: Date.now(),
			});
		}
	}

	async list(userId: number): Promise<AgentApp[]> {
		await this.initializeDefaults(userId);
		const values = await this.model.listApps(userId, AGENT_APP_MAX_LIST_ITEMS + 1);
		if (values.length > AGENT_APP_MAX_LIST_ITEMS) {
			throw new AgentFailure('limit_exceeded');
		}
		return values;
	}

	get(userId: number, appId: string): Promise<AgentApp | null> {
		validateUserId(userId);
		validateAgentId(appId);
		return this.model.getApp(userId, appId);
	}

	createApp(userId: number, name: string, definitionId = DEFAULT_APP_DEFINITION_ID): Promise<AgentApp> {
		validateUserId(userId);
		const definition = this.registeredDefinitions.find((definition) => definition.id === definitionId);
		if (definition === undefined) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.createApp({
			id: randomUUID(),
			userId,
			name: validateName(name),
			definition,
			isDefault: false,
			now: Date.now(),
		});
	}

	async setEnabled(userId: number, appId: string, enabled: boolean, version: number): Promise<AgentApp | null> {
		validateUserId(userId);
		validateAgentId(appId);
		if (typeof enabled !== 'boolean' || !Number.isSafeInteger(version) || version < 1) {
			throw new AgentFailure('invalid_input');
		}
		let updated: AgentApp | null;
		try {
			updated = await this.model.setEnabled(userId, appId, version, Date.now, (current) => {
				if (enabled && !current.definitionInstalled) {
					throw new AgentFailure('app_disabled');
				}
				return { enabled, invalidate: current.enabled !== enabled };
			});
		} catch (error) {
			if (error instanceof AgentFailure && error.code === 'operation_unknown') {
				await this.revokeAfterCommit(userId, appId, error);
			}
			throw error;
		}
		if (updated !== null && !updated.enabled) {
			await this.revokeAfterCommit(userId, appId);
		}
		if (updated?.enabled) {
			try {
				await this.activateRuntime(userId, appId);
			} catch (cause) {
				throw new AgentFailure('operation_unknown', { cause });
			}
		}
		return updated;
	}

	private async revokeAfterCommit(userId: number, appId: string, error?: unknown): Promise<void> {
		try {
			await this.revoke({ userId, appId, uncertain: error !== undefined });
		} catch (cleanupError) {
			throw new AgentFailure('operation_unknown', {
				cause:
					error === undefined
						? cleanupError
						: new AggregateError([error, cleanupError], 'App mutation and revocation failed'),
			});
		}
	}

	createThread(userId: number, appId: string, title: string): Promise<AgentThread | null> {
		validateUserId(userId);
		validateAgentId(appId);
		return this.model.createThread(userId, randomUUID(), appId, validateName(title), Date.now(), (threads) => {
			if (threads >= 512) {
				throw new AgentFailure('limit_exceeded');
			}
		});
	}
}
