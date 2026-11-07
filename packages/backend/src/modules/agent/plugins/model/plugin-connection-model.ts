import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type { PluginActor } from './plugin-types.js';
import type {
	PluginConnector,
	PluginConnection,
	PluginConnectionSource,
	PluginConnectionWrite,
} from './plugin-connection-types.js';
import type {
	PluginConnectionStorage,
	StoredPluginConnector,
	StoredPluginConnection,
} from '../storage/plugin-connection-storage.js';
import { PluginConnectionRefusal } from '../storage/plugin-connection-storage.js';

function toConnector(value: PluginConnector): StoredPluginConnector {
	return value.kind === 'none'
		? { kind: 'none' }
		: value.kind === 'http'
			? {
					kind: value.kind,
					endpoint: value.endpoint,
					privateAuthorities: value.privateAuthorities.map((item) => item),
				}
			: {
					kind: value.kind,
					connectionId: value.connectionId,
					argv: value.argv.map((item) => item),
					cwd: value.cwd,
				};
}

function view(value: StoredPluginConnection): PluginConnection {
	const connector: PluginConnector =
		value.connector.kind === 'none'
			? { kind: 'none' }
			: value.connector.kind === 'http'
				? {
						kind: value.connector.kind,
						endpoint: value.connector.endpoint,
						privateAuthorities: value.connector.privateAuthorities.map((item) => item),
					}
				: {
						kind: value.connector.kind,
						connectionId: value.connector.connectionId,
						argv: value.connector.argv.map((item) => item),
						cwd: value.connector.cwd,
					};
	return {
		instanceId: value.instanceId,
		revision: value.revision,
		connector,
		hasCredential: value.encryptedCredential !== null,
	};
}

export class PluginConnectionModel {
	constructor(
		private readonly storage: PluginConnectionStorage,
		private readonly tokens: SessionTokens,
		private readonly secrets: SecretBox | null,
	) {}

	private work<T>(action: () => Promise<T>): Promise<T> {
		return agentStorage(async () => {
			try {
				return await action();
			} catch (error) {
				if (error instanceof PluginConnectionRefusal) {
					throw new AgentFailure(error.code, { cause: error });
				}
				throw error;
			}
		});
	}

	async read(actor: PluginActor, appId: string, instanceId: string): Promise<PluginConnection> {
		return view(
			await this.work(() => this.storage.read(actor.userId, appId, instanceId, this.tokens.digest(actor.token))),
		);
	}

	async source(userId: number, appId: string, instanceId: string): Promise<PluginConnectionSource> {
		const value = await this.work(() => this.storage.read(userId, appId, instanceId, null));
		if (value.encryptedCredential !== null && !this.secrets) {
			throw new AgentFailure('provider_unavailable');
		}
		return {
			connection: view(value),
			credential:
				value.encryptedCredential === null
					? null
					: (this.secrets?.decrypt(
							value.encryptedCredential,
							'plugin-connection:' + userId + ':' + appId + ':' + instanceId,
						) ?? null),
		};
	}

	async write(
		actor: PluginActor,
		appId: string,
		instanceId: string,
		input: PluginConnectionWrite,
	): Promise<PluginConnection> {
		if (input.credential.action === 'replace' && !this.secrets) {
			throw new AgentFailure('provider_unavailable');
		}
		const credential =
			input.credential.action === 'keep'
				? { action: 'keep' as const }
				: {
						action: 'replace' as const,
						encrypted:
							input.credential.action === 'clear'
								? null
								: (this.secrets?.encrypt(
										input.credential.value,
										'plugin-connection:' + actor.userId + ':' + appId + ':' + instanceId,
									) ?? null),
					};
		return view(
			await this.work(() =>
				this.storage.write(
					actor.userId,
					appId,
					instanceId,
					this.tokens.digest(actor.token),
					input.expectedRevision,
					toConnector(input.connector),
					credential,
				),
			),
		);
	}
}
