import { createHash } from 'node:crypto';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { McpClient, McpCatalog } from '../../../../platform/mcp/mcp-client.js';
import { McpFailure } from '../../../../platform/mcp/mcp-client.js';
import { AgentFailure, isAgentDrainFailure, ToolCleanupFailure, ToolExecutionUnknown } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type {
	IntegrationStorage,
	StoredIntegration,
	StoredIntegrationConfiguration,
	StoredIntegrationFacts,
	StoredIntegrationReceipt,
} from '../storage/integration-storage.js';
import { IntegrationStorageRefusal } from '../storage/integration-storage.js';
import type {
	IntegrationConfiguration,
	IntegrationActor,
	IntegrationInput,
	IntegrationFacts,
	IntegrationRecord,
	IntegrationDiscovery,
	IntegrationInvocation,
	IntegrationReply,
} from './integration-types.js';

function toStored(value: IntegrationConfiguration): StoredIntegrationConfiguration {
	if (value.kind === 'mcp') {
		return {
			kind: 'mcp',
			displayName: value.displayName,
			endpoint: value.endpoint,
			privateHostExceptions: value.privateHostExceptions.map((host) => host),
			protocolVersion: value.protocolVersion,
		};
	}
	return {
		kind: 'acp',
		displayName: value.displayName,
		connectionId: value.connectionId,
		argv: value.argv.map((arg) => arg),
		cwd: value.cwd,
		protocolVersion: value.protocolVersion,
	};
}

function fromStored(value: StoredIntegrationConfiguration): IntegrationConfiguration {
	if (value.kind === 'mcp') {
		return {
			kind: 'mcp',
			displayName: value.displayName,
			endpoint: value.endpoint,
			privateHostExceptions: value.privateHostExceptions.map((host) => host),
			protocolVersion: value.protocolVersion,
		};
	}
	return {
		kind: 'acp',
		displayName: value.displayName,
		connectionId: value.connectionId,
		argv: value.argv.map((arg) => arg),
		cwd: value.cwd,
		protocolVersion: value.protocolVersion,
	};
}

function view(value: StoredIntegration): IntegrationRecord {
	return {
		id: value.id,
		appId: value.appId,
		configuration: fromStored(value.configuration),
		enabled: value.enabled,
		hasCredential: value.encryptedCredential !== null,
		credentialRevision: value.credentialRevision,
		schemaHash: value.schemaHash,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function facts(value: StoredIntegrationFacts): IntegrationFacts {
	return { exists: value.exists, enabled: value.enabled, identityUserId: value.identityUserId, count: value.count };
}

function creation(value: StoredIntegrationReceipt): IntegrationRecord {
	return {
		id: value.id,
		appId: value.appId,
		configuration: fromStored(value.configuration),
		enabled: value.enabled,
		hasCredential: value.hasCredential,
		credentialRevision: value.credentialRevision,
		schemaHash: value.schemaHash,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function discovery(value: McpCatalog): IntegrationDiscovery {
	return {
		serverName: value.serverName,
		serverVersion: value.serverVersion,
		protocolVersion: value.protocolVersion,
		tools: value.tools.map((item) => ({
			name: item.name,
			description: item.description,
			inputSchemaJson: item.inputSchemaJson,
		})),
		resources: value.resources.map((item) => ({ uri: item.uri, name: item.name })),
		prompts: value.prompts.map((item) => ({ name: item.name, description: item.description })),
	};
}

async function storage<T>(action: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await action();
		} catch (error) {
			if (error instanceof IntegrationStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

export class IntegrationModel {
	constructor(
		private readonly storage: IntegrationStorage,
		private readonly secrets: SecretBox | null,
		private readonly tokens: SessionTokens,
		private readonly mcp: McpClient,
		private readonly client: { name: string; version: string },
	) {}

	private scope(value: { userId: number; appId: string }): { userId: number; appId: string } {
		return { userId: value.userId, appId: value.appId };
	}

	private credential(
		actor: IntegrationActor,
		id: string,
		input: IntegrationInput,
		current: StoredIntegration | null,
	): string | null {
		if (input.credential.action === 'keep') {
			return current?.encryptedCredential ?? null;
		}
		if (input.credential.action === 'clear') {
			return null;
		}
		if (!this.secrets) {
			throw new AgentFailure('storage_unavailable');
		}
		return this.secrets.encrypt(
			input.credential.value,
			'integration:' + actor.userId + ':' + actor.appId + ':' + id,
		);
	}

	async list(actor: { userId: number; appId: string }): Promise<IntegrationRecord[]> {
		return (await storage(() => this.storage.list(this.scope(actor)))).map(view);
	}

	async get(actor: { userId: number; appId: string }, id: string): Promise<IntegrationRecord> {
		const row = await storage(() => this.storage.get(this.scope(actor), id));
		if (!row) {
			throw new AgentFailure('not_found');
		}
		return view(row);
	}

	intentHash(input: IntegrationInput): string {
		return createHash('sha256')
			.update(
				JSON.stringify({
					configuration: toStored(input.configuration),
					enabled: input.enabled,
					credential:
						input.credential.action === 'replace'
							? { action: 'replace', value: input.credential.value }
							: { action: input.credential.action },
				}),
			)
			.digest('hex');
	}

	async create(
		actor: IntegrationActor,
		id: string,
		key: string,
		input: IntegrationInput,
		authorize: (facts: IntegrationFacts) => void,
		admit: (facts: IntegrationFacts) => void,
	): Promise<IntegrationRecord> {
		return creation(
			await storage(() =>
				this.storage.create(
					this.scope(actor),
					this.tokens.digest(actor.token),
					id,
					key,
					this.intentHash(input),
					Date.now(),
					(current) => authorize(facts(current)),
					(current) => {
						admit(facts(current));
						return {
							configuration: toStored(input.configuration),
							enabled: input.enabled,
							encryptedCredential: this.credential(actor, id, input, null),
							credentialRevision: input.credential.action === 'replace' ? 1 : 0,
						};
					},
				),
			),
		);
	}

	async update(
		actor: IntegrationActor,
		id: string,
		version: number,
		input: IntegrationInput,
		admit: (facts: IntegrationFacts) => void,
	): Promise<IntegrationRecord> {
		const saved = view(
			await storage(() =>
				this.storage.update(
					this.scope(actor),
					this.tokens.digest(actor.token),
					id,
					version,
					Date.now(),
					(current, row) => {
						admit(facts(current));
						return {
							configuration: toStored(input.configuration),
							enabled: input.enabled,
							encryptedCredential: this.credential(actor, id, input, row),
							credentialRevision: row.credentialRevision + (input.credential.action === 'keep' ? 0 : 1),
						};
					},
				),
			),
		);
		await this.retire(id);
		return saved;
	}

	async remove(
		actor: IntegrationActor,
		id: string,
		version: number,
		admit: (facts: IntegrationFacts) => void,
	): Promise<void> {
		await storage(() =>
			this.storage.remove(this.scope(actor), this.tokens.digest(actor.token), id, version, (current) =>
				admit(facts(current)),
			),
		);
		await this.retire(id);
	}

	private async retire(id: string): Promise<void> {
		try {
			await this.mcp.close(id);
		} catch (error) {
			this.networkFailure(error, false);
		}
	}

	async discover(
		actor: IntegrationActor,
		id: string,
		version: number,
		signal: AbortSignal,
		admit: (facts: IntegrationFacts) => void,
	): Promise<{ integration: IntegrationRecord; catalog: IntegrationDiscovery }> {
		const row = await this.current(actor, id, version);
		const endpoint = this.endpoint(actor, row);
		let catalog: IntegrationDiscovery;
		try {
			const result = await this.mcp.discover(endpoint, signal);
			catalog = discovery(result);
		} catch (error) {
			this.networkFailure(error, false);
		}
		const hash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
		const saved = await storage(() =>
			this.storage.discover(this.scope(actor), this.tokens.digest(actor.token), id, version, hash, (current) => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				admit(facts(current));
			}),
		);
		return { integration: view(saved), catalog };
	}

	async catalog(
		actor: { userId: number; appId: string },
		id: string,
		version: number,
		signal: AbortSignal,
	): Promise<{ integration: IntegrationRecord; catalog: IntegrationDiscovery; schemaHash: string }> {
		const row = await this.current(actor, id, version);
		let catalog: IntegrationDiscovery;
		try {
			catalog = discovery(await this.mcp.discover(this.endpoint(actor, row), signal));
		} catch (error) {
			this.networkFailure(error, false);
		}
		await this.current(actor, id, version);
		return {
			integration: view(row),
			catalog,
			schemaHash: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
		};
	}

	private async current(
		actor: { userId: number; appId: string },
		id: string,
		version: number,
	): Promise<StoredIntegration> {
		const row = await storage(() => this.storage.get(this.scope(actor), id));
		if (!row) {
			throw new AgentFailure('not_found');
		}
		if (row.version !== version || !row.enabled) {
			throw new AgentFailure('version_conflict');
		}
		return row;
	}

	private endpoint(
		actor: { userId: number; appId: string },
		row: StoredIntegration,
	): import('../../../../platform/mcp/mcp-client.js').McpEndpoint {
		if (row.configuration.kind !== 'mcp') {
			throw new AgentFailure('invalid_input');
		}
		let credential: string | null = null;
		if (row.encryptedCredential !== null) {
			if (!this.secrets) {
				throw new AgentFailure('storage_unavailable');
			}
			try {
				credential = this.secrets.decrypt(
					row.encryptedCredential,
					'integration:' + actor.userId + ':' + actor.appId + ':' + row.id,
				);
			} catch (cause) {
				throw new AgentFailure('storage_unavailable', { cause });
			}
		}
		return {
			client: { name: this.client.name, version: this.client.version },
			key: row.id,
			generation: row.version,
			url: row.configuration.endpoint,
			privateAuthorities: row.configuration.privateHostExceptions.map((host) => host),
			credential,
			protocolVersion: row.configuration.protocolVersion,
		};
	}

	async invoke(
		actor: { userId: number; appId: string },
		input: IntegrationInvocation,
		signal: AbortSignal,
		validate: () => Promise<void>,
		admit: (record: IntegrationRecord, catalog: IntegrationDiscovery, hash: string) => void,
	): Promise<IntegrationReply> {
		const row = await this.current(actor, input.id, input.version);
		const endpoint = this.endpoint(actor, row);
		let dispatched = false;
		try {
			const catalog = discovery(await this.mcp.discover(endpoint, signal));
			const hash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
			admit(view(row), catalog, hash);
			await this.current(actor, input.id, input.version);
			await validate();
			signal.throwIfAborted();
			dispatched = true;
			const result = await this.mcp.invoke(
				endpoint,
				{
					kind: input.kind,
					name: input.name,
					argumentsJson: input.argumentsJson,
					resume:
						input.resume === null
							? null
							: {
									requestState: input.resume.requestState,
									inputResponsesJson: input.resume.inputResponsesJson,
								},
				},
				signal,
			);
			await this.current(actor, input.id, input.version);
			await validate();
			return result.kind === 'complete'
				? { kind: 'complete', resultJson: result.resultJson }
				: {
						kind: 'input_required',
						requestState: result.requestState,
						inputRequestsJson: result.inputRequestsJson,
					};
		} catch (error) {
			if (error instanceof AgentFailure && (isAgentDrainFailure(error) || !dispatched || input.kind !== 'tool')) {
				throw error;
			}
			this.networkFailure(error, dispatched && input.kind === 'tool');
		}
	}

	async close(): Promise<void> {
		try {
			await this.mcp.closeAll();
		} catch (error) {
			this.networkFailure(error, false);
		}
	}

	private networkFailure(error: unknown, mutation: boolean): never {
		if (error instanceof McpFailure && error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		if (mutation) {
			throw new ToolExecutionUnknown({ cause: error });
		}
		if (error instanceof McpFailure && error.kind === 'limit_exceeded') {
			throw new AgentFailure('limit_exceeded', { cause: error });
		}
		throw new AgentFailure('provider_unavailable', { cause: error });
	}
}
