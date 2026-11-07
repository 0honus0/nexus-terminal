import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { JsonSchemaValidator } from '../../../../platform/validation/json-schema-validator.js';
import { AgentFailure } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type {
	PluginInstanceStorage,
	StoredPluginConfigurationPrincipal,
	StoredPluginInstance,
	StoredPluginInstanceSource,
} from '../storage/plugin-instance-storage.js';
import { PluginInstanceRefusal } from '../storage/plugin-instance-storage.js';
import type {
	PluginConfigurationMutation,
	PluginConfigurationPrincipal,
	PluginConfigurationWrite,
	PluginInstance,
	PluginInstanceSource,
} from './plugin-instance-types.js';
import type { PluginActor } from './plugin-types.js';
import { fromStoredPluginManifest } from './plugin-manifest-model.js';
import type { PluginDataRecord, PluginDataPage } from './plugin-data-types.js';

function fromInstance(value: StoredPluginInstance): PluginInstance {
	return {
		id: value.id,
		appId: value.appId,
		packageId: value.packageId,
		name: value.name,
		selected: value.selected,
		enabled: value.enabled,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function fromSource(value: StoredPluginInstanceSource): PluginInstanceSource {
	return {
		instance: fromInstance(value.instance),
		configuration: {
			instanceId: value.configuration.instanceId,
			packageId: value.configuration.packageId,
			revision: value.configuration.revision,
			schemaRevision: value.configuration.schemaRevision,
			documentJson: value.configuration.documentJson,
		},
		package: {
			packageId: value.package.packageId,
			version: value.package.version,
			packageHash: value.package.packageHash,
			publisherKeyId: value.package.publisherKeyId,
		},
		packageRevision: value.packageRevision,
		manifest: fromStoredPluginManifest(value.manifest),
	};
}

function record(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

/** Compare actual changed subtrees; editing a permitted child never grants its siblings. */
function validateEditable(before: unknown, after: unknown, editable: readonly string[]): void {
	const pending = [{ before, after, path: '' }];
	while (pending.length) {
		const next = pending.pop();
		if (!next) {
			throw new AgentFailure('internal_failure');
		}
		if (
			isDeepStrictEqual(next.before, next.after) ||
			editable.some((path) => path === '' || next.path === path || next.path.startsWith(path + '/'))
		) {
			continue;
		}
		if (!record(next.before) || !record(next.after)) {
			throw new AgentFailure('forbidden');
		}
		for (const key of new Set([...Object.keys(next.before), ...Object.keys(next.after)])) {
			pending.push({
				before: Object.hasOwn(next.before, key) ? next.before[key] : undefined,
				after: Object.hasOwn(next.after, key) ? next.after[key] : undefined,
				path: next.path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
			});
		}
	}
}

export class PluginInstanceModel {
	constructor(
		private readonly storage: PluginInstanceStorage,
		private readonly tokens: SessionTokens,
	) {}

	async dataRead(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		key: string,
	): Promise<PluginDataRecord | null> {
		const value = await this.work(() => this.storage.dataRead(this.principal(principal), namespace, key));
		return value === null ? null : { key: value.key, revision: value.revision, documentJson: value.documentJson };
	}

	async dataList(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		after: string | null,
		byteBudget: number,
	): Promise<PluginDataPage> {
		const value = await this.work(() =>
			this.storage.dataList(this.principal(principal), namespace, after, byteBudget),
		);
		return {
			items: value.items.map((item) => ({ key: item.key, revision: item.revision, deleted: item.deleted })),
			nextCursor: value.nextCursor,
		};
	}

	async dataWrite(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		key: string,
		expectedRevision: number,
		documentJson: string | null,
	): Promise<PluginDataRecord> {
		const value = await this.work(() =>
			this.storage.dataWrite(
				this.principal(principal),
				namespace,
				key,
				expectedRevision,
				documentJson,
				Date.now(),
			),
		);
		return { key: value.key, revision: value.revision, documentJson: value.documentJson };
	}

	private work<T>(action: () => Promise<T>): Promise<T> {
		return agentStorage(async () => {
			try {
				return await action();
			} catch (error) {
				if (error instanceof PluginInstanceRefusal) {
					throw new AgentFailure(error.code, { cause: error });
				}
				throw error;
			}
		});
	}

	private principal(value: PluginConfigurationPrincipal): StoredPluginConfigurationPrincipal {
		return value.kind === 'manual'
			? { kind: 'manual', userId: value.actor.userId, digest: this.tokens.digest(value.actor.token) }
			: {
					kind: 'run',
					userId: value.userId,
					appId: value.appId,
					runId: value.runId,
					executionGeneration: value.executionGeneration,
					operationId: value.operationId,
					policyRevision: value.policyRevision,
					callerInstanceId: value.callerInstanceId,
					callerGeneration: value.callerGeneration,
					participants: value.participants.map((item) => ({
						instanceId: item.instanceId,
						packageId: item.packageId,
						generation: item.generation,
						configurationRevision: item.configurationRevision,
						packageRevision: item.packageRevision,
					})),
				};
	}

	async list(userId: number, appId: string): Promise<PluginInstance[]> {
		return (await this.work(() => this.storage.list(userId, appId))).map(fromInstance);
	}

	async listAuthorized(principal: PluginConfigurationPrincipal, appId: string): Promise<PluginInstance[]> {
		return (await this.work(() => this.storage.listAuthorized(this.principal(principal), appId))).map(fromInstance);
	}

	async source(userId: number, appId: string, instanceId: string): Promise<PluginInstanceSource> {
		return fromSource(await this.work(() => this.storage.source(userId, appId, instanceId)));
	}

	async read(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
	): Promise<PluginInstanceSource> {
		return fromSource(await this.work(() => this.storage.read(this.principal(principal), appId, instanceId)));
	}

	async create(actor: PluginActor, appId: string, packageId: string, name: string): Promise<PluginInstance> {
		return fromInstance(
			await this.work(() =>
				this.storage.create(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					packageId,
					randomUUID(),
					name,
					Date.now(),
				),
			),
		);
	}

	async update(
		actor: PluginActor,
		appId: string,
		instanceId: string,
		expectedRevision: number,
		input: { name: string; selected: boolean; enabled: boolean },
	): Promise<PluginInstance> {
		return fromInstance(
			await this.work(() =>
				this.storage.update(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					instanceId,
					expectedRevision,
					{ name: input.name, selected: input.selected, enabled: input.enabled },
					Date.now(),
				),
			),
		);
	}

	async write(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: PluginConfigurationWrite,
	): Promise<PluginConfigurationMutation> {
		const document = this.document(command.documentJson);
		const documentJson = JSON.stringify(document);
		const requestHash = createHash('sha256')
			.update(
				JSON.stringify([
					1,
					appId,
					instanceId,
					command.expectedPackageRevision,
					command.expectedRevision,
					command.schemaRevision,
					documentJson,
				]),
			)
			.digest('hex');
		const result = await this.work(() =>
			this.storage.write(
				this.principal(principal),
				appId,
				instanceId,
				{
					operationKey: command.operationKey,
					expectedRevision: command.expectedRevision,
					schemaRevision: command.schemaRevision,
					documentJson,
					requestHash,
					now: Date.now(),
				},
				(stored) => {
					const current = fromSource(stored);
					return this.validateWrite(current, principal, command, document);
				},
			),
		);
		return {
			changed: result.changed,
			configuration: {
				instanceId: result.configuration.instanceId,
				packageId: result.configuration.packageId,
				revision: result.configuration.revision,
				schemaRevision: result.configuration.schemaRevision,
				documentJson: result.configuration.documentJson,
			},
		};
	}

	async inspect(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: PluginConfigurationWrite,
	): Promise<PluginInstanceSource> {
		const current = await this.read(principal, appId, instanceId);
		this.validateWrite(current, principal, command, this.document(command.documentJson));
		return current;
	}

	private document(documentJson: string): Record<string, unknown> {
		let document: unknown;
		try {
			document = JSON.parse(documentJson);
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
		if (!record(document)) {
			throw new AgentFailure('invalid_input');
		}
		return document;
	}

	private validateWrite(
		current: PluginInstanceSource,
		principal: PluginConfigurationPrincipal,
		command: PluginConfigurationWrite,
		document: Record<string, unknown>,
	): { changed: boolean } {
		const settings = current.manifest.contributions.settings;
		if (
			!settings ||
			settings.schemaRevision !== command.schemaRevision ||
			current.packageRevision !== command.expectedPackageRevision ||
			current.configuration.revision !== command.expectedRevision
		) {
			throw new AgentFailure('version_conflict');
		}
		if (!new JsonSchemaValidator(settings.schemaJson).validate(document)) {
			throw new AgentFailure('invalid_input');
		}
		const before: unknown = JSON.parse(current.configuration.documentJson);
		if (principal.kind === 'run') {
			validateEditable(before, document, settings.agentEditablePaths);
		}
		return {
			changed:
				current.configuration.schemaRevision !== command.schemaRevision || !isDeepStrictEqual(before, document),
		};
	}
}
