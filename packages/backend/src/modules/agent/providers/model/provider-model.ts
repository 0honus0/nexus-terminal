import { agentStorage } from '../../agent-storage-failure.js';
import { createHash } from 'node:crypto';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { ModelNetworkPort, EndpointModel } from '../../../../platform/ai/model-port.js';
import { toProviderRequestFailure } from './provider-network-failure.js';
import type { ProviderStorage, ProviderWrite } from '../storage/provider-storage.js';
import type {
	ProviderRecord,
	ProviderMutation,
	ProviderDeletion,
	ProviderWriteCommand,
	ProviderProbeCommand,
	ProviderProbeResult,
	ProviderView,
	ProviderModelInput,
	ProviderModelView,
	DiscoveredModel,
	ProviderObservation,
} from './provider-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { cloneProviderModel, shouldResetProviderObservations, mayDeleteProvider } from '../provider-rules.js';
import { fromStoredProvider, toStoredModel, toStoredObservation } from './provider-projection.js';
import { AGENT_MODEL_CAPABILITY_FIELDS } from '@nexus-terminal/shared/agent/providers/values';

function toModelView(model: ProviderModelInput, observation?: ProviderObservation): ProviderModelView {
	const capabilityConflicts = AGENT_MODEL_CAPABILITY_FIELDS.filter(
		(field) =>
			model[field] !== undefined &&
			observation?.capabilities[field] !== undefined &&
			JSON.stringify(model[field]) !== JSON.stringify(observation.capabilities[field]),
	);
	return {
		...cloneProviderModel(model),
		capabilitySources: {
			contextWindow: 'manual',
			maxOutputTokens: 'manual',
			supportsTools: 'manual',
			...(model.supportsImageInput === undefined ? {} : { supportsImageInput: 'manual' as const }),
			...(model.supportsFileInput === undefined ? {} : { supportsFileInput: 'manual' as const }),
			...(model.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: 'manual' as const }),
			...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: 'manual' as const }),
			...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: 'manual' as const }),
			...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: 'manual' as const }),
		},
		...(observation === undefined
			? {}
			: {
					providerCapabilities: {
						source: observation.source,
						sourceVersion: observation.sourceVersion,
						updatedAt: observation.updatedAt,
						capabilities: {
							...(observation.capabilities.contextWindow === undefined
								? {}
								: { contextWindow: observation.capabilities.contextWindow }),
							...(observation.capabilities.maxOutputTokens === undefined
								? {}
								: { maxOutputTokens: observation.capabilities.maxOutputTokens }),
							...(observation.capabilities.supportsTools === undefined
								? {}
								: { supportsTools: observation.capabilities.supportsTools }),
							...(observation.capabilities.supportsImageInput === undefined
								? {}
								: { supportsImageInput: observation.capabilities.supportsImageInput }),
							...(observation.capabilities.supportsFileInput === undefined
								? {}
								: { supportsFileInput: observation.capabilities.supportsFileInput }),
							...(observation.capabilities.supportsPromptCacheKey === undefined
								? {}
								: { supportsPromptCacheKey: observation.capabilities.supportsPromptCacheKey }),
							...(observation.capabilities.reasoningEfforts === undefined
								? {}
								: { reasoningEfforts: [...observation.capabilities.reasoningEfforts] }),
							...(observation.capabilities.defaultReasoningEffort === undefined
								? {}
								: { defaultReasoningEffort: observation.capabilities.defaultReasoningEffort }),
							...(observation.capabilities.reasoningMandatory === undefined
								? {}
								: { reasoningMandatory: observation.capabilities.reasoningMandatory }),
						},
					},
				}),
		...(capabilityConflicts.length ? { capabilityConflicts } : {}),
	};
}

export class ProviderModel {
	constructor(
		private readonly storage: ProviderStorage,
		private readonly box: SecretBox | null,
		private readonly network: ModelNetworkPort,
	) {}

	private scope(userId: number, id: string): string {
		return `agent-provider:${userId}:${id}`;
	}

	toView(row: ProviderRecord): ProviderView {
		return {
			id: row.id,
			kind: 'openai-compatible',
			displayName: row.displayName,
			baseUrl: row.baseUrl,
			protocol: row.protocol,
			models: row.models.map((model) =>
				toModelView(
					model,
					row.observations.find((observation) => observation.modelId === model.id),
				),
			),
			enabled: row.enabled,
			hasCredential: row.hasCredential,
			credentialRevision: row.credentialRevision,
			version: row.version,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	private write({ userId, id, input, now }: ProviderWriteCommand): ProviderWrite {
		let protectedCredential: string | undefined;
		if (input.credential !== undefined) {
			if (!this.box) {
				throw new AgentFailure('provider_unavailable');
			}
			protectedCredential = this.box.encrypt(input.credential, this.scope(userId, id));
		}
		return {
			userId,
			id,
			displayName: input.displayName,
			baseUrl: input.baseUrl,
			protocol: input.protocol,
			models: input.models.map(toStoredModel),
			enabled: input.enabled,
			now,
			...(protectedCredential === undefined ? {} : { protectedCredential }),
			...(input.clearCredential === undefined ? {} : { clearCredential: input.clearCredential }),
		};
	}

	async list(userId: number): Promise<ProviderRecord[]> {
		return (await agentStorage(() => this.storage.list(userId))).map(fromStoredProvider);
	}

	async get(userId: number, id: string): Promise<ProviderRecord | null> {
		const row = await agentStorage(() => this.storage.get(userId, id));
		return row === null ? null : fromStoredProvider(row);
	}

	async create(command: ProviderWriteCommand): Promise<ProviderRecord> {
		return fromStoredProvider(await agentStorage(() => this.storage.create(this.write(command))));
	}

	async update(command: ProviderWriteCommand, version: number): Promise<ProviderMutation> {
		const result = await agentStorage(() =>
			this.storage.update(this.write(command), version, (current) =>
				shouldResetProviderObservations(fromStoredProvider(current), command.input),
			),
		);
		return result.status === 'ok'
			? { status: 'ok', provider: fromStoredProvider(result.provider) }
			: { status: result.status };
	}

	async remove(userId: number, id: string, version: number, now: number): Promise<ProviderDeletion> {
		const result = await agentStorage(() =>
			this.storage.remove(userId, id, version, now, (usage) =>
				mayDeleteProvider({ runStatuses: usage.runStatuses.map((status) => status) }),
			),
		);
		return { status: result.status };
	}

	async credential(row: ProviderRecord): Promise<string | null> {
		const encrypted = await agentStorage(() =>
			this.storage.credential(row.userId, row.id, row.version, row.credentialRevision),
		);
		if (row.hasCredential && encrypted === null) {
			throw new AgentFailure('provider_configuration_stale');
		}
		if (encrypted === null) {
			return null;
		}
		if (!this.box) {
			throw new AgentFailure('provider_unavailable');
		}
		try {
			return this.box.decrypt(encrypted, this.scope(row.userId, row.id));
		} catch (error) {
			throw new AgentFailure('provider_unavailable', { cause: error });
		}
	}

	async guardCurrent(row: ProviderRecord): Promise<void> {
		const current = await this.get(row.userId, row.id);
		if (
			!current ||
			!current.enabled ||
			current.version !== row.version ||
			current.credentialRevision !== row.credentialRevision
		) {
			throw new AgentFailure('provider_configuration_stale');
		}
	}

	async recordDiscovery(provider: ProviderRecord, discovered: DiscoveredModel[]): Promise<void> {
		const source =
			'openai-compatible:' +
			createHash('sha256').update(provider.baseUrl, 'utf8').digest('base64url') +
			':/models:nexus_capabilities';
		const updatedAt = Date.now();
		const items: ProviderObservation[] = discovered
			.filter((model) => model.providerCapabilities !== undefined)
			.map((model) => ({
				modelId: model.id,
				source,
				sourceVersion:
					'sha256:' +
					createHash('sha256').update(JSON.stringify(model.providerCapabilities), 'utf8').digest('base64url'),
				updatedAt,
				capabilities: {
					...(model.providerCapabilities?.contextWindow === undefined
						? {}
						: { contextWindow: model.providerCapabilities.contextWindow }),
					...(model.providerCapabilities?.maxOutputTokens === undefined
						? {}
						: { maxOutputTokens: model.providerCapabilities.maxOutputTokens }),
					...(model.providerCapabilities?.supportsTools === undefined
						? {}
						: { supportsTools: model.providerCapabilities.supportsTools }),
					...(model.providerCapabilities?.supportsImageInput === undefined
						? {}
						: { supportsImageInput: model.providerCapabilities.supportsImageInput }),
					...(model.providerCapabilities?.supportsFileInput === undefined
						? {}
						: { supportsFileInput: model.providerCapabilities.supportsFileInput }),
					...(model.providerCapabilities?.supportsPromptCacheKey === undefined
						? {}
						: { supportsPromptCacheKey: model.providerCapabilities.supportsPromptCacheKey }),
					...(model.providerCapabilities?.reasoningEfforts === undefined
						? {}
						: { reasoningEfforts: [...model.providerCapabilities.reasoningEfforts] }),
					...(model.providerCapabilities?.defaultReasoningEffort === undefined
						? {}
						: { defaultReasoningEffort: model.providerCapabilities.defaultReasoningEffort }),
					...(model.providerCapabilities?.reasoningMandatory === undefined
						? {}
						: { reasoningMandatory: model.providerCapabilities.reasoningMandatory }),
				},
			}));
		if (
			!(await agentStorage(() =>
				this.storage.recordObservations(
					provider.userId,
					provider.id,
					provider.version,
					provider.credentialRevision,
					items.map(toStoredObservation),
				),
			))
		) {
			throw new AgentFailure('provider_configuration_stale');
		}
	}

	private toDiscovered(rows: EndpointModel[]): DiscoveredModel[] {
		return rows.map((row) => ({
			id: row.id,
			...(row.ownedBy === undefined ? {} : { ownedBy: row.ownedBy }),
			...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
			...(row.capabilities === undefined
				? {}
				: {
						providerCapabilities: {
							...(row.capabilities.contextWindow === undefined
								? {}
								: { contextWindow: row.capabilities.contextWindow }),
							...(row.capabilities.maxOutputTokens === undefined
								? {}
								: { maxOutputTokens: row.capabilities.maxOutputTokens }),
							...(row.capabilities.supportsTools === undefined
								? {}
								: { supportsTools: row.capabilities.supportsTools }),
							...(row.capabilities.supportsImageInput === undefined
								? {}
								: { supportsImageInput: row.capabilities.supportsImageInput }),
							...(row.capabilities.supportsFileInput === undefined
								? {}
								: { supportsFileInput: row.capabilities.supportsFileInput }),
							...(row.capabilities.supportsPromptCacheKey === undefined
								? {}
								: { supportsPromptCacheKey: row.capabilities.supportsPromptCacheKey }),
							...(row.capabilities.reasoningEfforts === undefined
								? {}
								: { reasoningEfforts: [...row.capabilities.reasoningEfforts] }),
							...(row.capabilities.defaultReasoningEffort === undefined
								? {}
								: { defaultReasoningEffort: row.capabilities.defaultReasoningEffort }),
							...(row.capabilities.reasoningMandatory === undefined
								? {}
								: { reasoningMandatory: row.capabilities.reasoningMandatory }),
						},
					}),
		}));
	}

	async discover(url: string, credential: string | null, signal: AbortSignal): Promise<DiscoveredModel[]> {
		try {
			return this.toDiscovered(await this.network.discover(url, credential, signal));
		} catch (error) {
			throw toProviderRequestFailure(error);
		}
	}

	async probe(input: ProviderProbeCommand, signal: AbortSignal): Promise<ProviderProbeResult> {
		try {
			const result = await this.network.probe(
				{
					baseUrl: input.baseUrl,
					protocol: input.protocol,
					modelId: input.modelId,
					credential: input.credential,
					maxOutputTokens: input.maxOutputTokens,
					usesReasoning: input.usesReasoning,
					...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
				},
				signal,
			);
			return {
				...(result.usage === undefined
					? {}
					: { usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } }),
			};
		} catch (error) {
			throw toProviderRequestFailure(error);
		}
	}
}
