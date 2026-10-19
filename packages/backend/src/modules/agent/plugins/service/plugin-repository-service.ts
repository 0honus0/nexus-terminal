import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';
import {
	AGENT_PLUGIN_VERSION_PATTERN,
	AGENT_PLUGIN_MAX_REPOSITORIES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type { PluginRepositoryModel } from '../model/plugin-repository-model.js';
import type { PluginService } from './plugin-service.js';
import type {
	PluginActor,
	PluginCatalog,
	PluginCatalogStage,
	PluginStage,
	PluginInstallation,
	PluginRepositorySettings,
	PluginRecommended,
} from '../model/plugin-types.js';
import { OFFICIAL_PLUGIN_SOURCE, comparePluginVersions } from './plugin-source.js';

function identity(actor: PluginActor, userId: number | null): void {
	if (actor.userId !== userId) {
		throw new AgentFailure('unauthenticated');
	}
}

export class PluginRepositoryService {
	private readonly pending = new Set<Promise<unknown>>();
	private readonly stop = new AbortController();
	private lane: Promise<unknown> = Promise.resolve();
	private closing = false;
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: PluginRepositoryModel,
		private readonly plugins: PluginService,
		private readonly productVersion: string,
	) {
		if (!AGENT_PLUGIN_VERSION_PATTERN.test(productVersion)) {
			throw new Error('Invalid installed product version');
		}
	}

	get(actor: PluginActor): Promise<PluginRepositorySettings> {
		return this.task(() => this.model.get(actor, (userId) => identity(actor, userId)));
	}

	put(
		actor: PluginActor,
		produce: (signal: AbortSignal) => Promise<{ version: number; repositories: { url: string }[] }>,
	): Promise<PluginRepositorySettings> {
		return this.task(async (signal) => {
			const { version, repositories } = await produce(signal);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			if (repositories.length > AGENT_PLUGIN_MAX_REPOSITORIES) {
				throw new AgentFailure('limit_exceeded');
			}
			return this.model.put(
				actor,
				version,
				repositories.map((item) => ({ url: item.url })),
				(userId, current) => {
					identity(actor, userId);
					if (current.version !== version) {
						throw new AgentFailure('version_conflict');
					}
				},
			);
		});
	}

	private async readCatalog(
		actor: PluginActor,
		url: string,
		signal: AbortSignal,
	): Promise<{ catalog: PluginCatalog; settingsVersion: number }> {
		const current = await this.model.get(actor, (userId) => identity(actor, userId));
		const official = url === OFFICIAL_PLUGIN_SOURCE.catalogUrl;
		if (!official && !current.repositories.some((item) => item.url === url)) {
			throw new AgentFailure('forbidden');
		}
		const catalog = await this.model.catalog(url, signal, (sdk, min, max) => {
			if (comparePluginVersions(min, max) > 0) {
				throw new AgentFailure('provider_unavailable');
			}
			return (
				sdk === '1' &&
				comparePluginVersions(this.productVersion, min) >= 0 &&
				comparePluginVersions(this.productVersion, max) <= 0
			);
		});
		if (official) {
			const publisher = catalog.publishers.find((item) => item.keyId === OFFICIAL_PLUGIN_SOURCE.publisherKeyId);
			if (
				!publisher ||
				publisher.publicKeyPem.trim() !== OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem.trim() ||
				catalog.packages.some((item) => item.publisherKeyId !== OFFICIAL_PLUGIN_SOURCE.publisherKeyId)
			) {
				throw new AgentFailure('forbidden');
			}
		}
		const latest = await this.model.get(actor, (userId) => identity(actor, userId));
		if (latest.version !== current.version || signal.aborted) {
			throw new AgentFailure(signal.aborted ? 'provider_unavailable' : 'version_conflict');
		}
		return { catalog, settingsVersion: current.version };
	}

	catalog(actor: PluginActor, url: string): Promise<PluginCatalog> {
		return this.task(async (signal) => (await this.readCatalog(actor, url, signal)).catalog);
	}

	private async stageEntry(
		actor: PluginActor,
		request: PluginCatalogStage,
		signal: AbortSignal,
	): Promise<PluginStage> {
		const { catalog, settingsVersion } = await this.readCatalog(actor, request.repositoryUrl, signal);
		const entry = catalog.packages.find((item) => item.appId === request.appId && item.version === request.version);
		if (!entry) {
			throw new AgentFailure('not_found');
		}
		if (!entry.compatible) {
			throw new AgentFailure('forbidden');
		}
		if (request.repositoryUrl === OFFICIAL_PLUGIN_SOURCE.catalogUrl) {
			const trusted = (await this.plugins.publishers(actor)).find(
				(item) => item.keyId === OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
			);
			if (trusted?.revokedAt !== null && trusted !== undefined) {
				throw new AgentFailure('forbidden');
			}
			if (trusted === undefined) {
				await this.plugins.putPublisher(
					actor,
					OFFICIAL_PLUGIN_SOURCE.publisherLabel,
					OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem,
				);
			}
		}
		return this.plugins.stagePackage(
			actor,
			{ appId: entry.appId, version: entry.version, publisherKeyId: entry.publisherKeyId },
			async (taskSignal) => {
				const lifetime = AbortSignal.any([signal, taskSignal]);
				const bytes = await this.model.download(entry, lifetime);
				const latest = await this.model.get(actor, (userId) => identity(actor, userId));
				if (latest.version !== settingsVersion) {
					throw new AgentFailure('version_conflict');
				}
				if (lifetime.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				return bytes;
			},
		);
	}

	stage(actor: PluginActor, produce: (signal: AbortSignal) => Promise<PluginCatalogStage>): Promise<PluginStage> {
		return this.task(async (signal) => {
			const input = await produce(signal);
			return this.stageEntry(
				actor,
				{ repositoryUrl: input.repositoryUrl, appId: input.appId, version: input.version },
				signal,
			);
		});
	}

	private async recommendation(actor: PluginActor, signal: AbortSignal): Promise<PluginRecommended> {
		const installation =
			(await this.plugins.installations(actor)).find(
				(item) => item.definitionId === OFFICIAL_PLUGIN_SOURCE.recommendedAppId && item.status === 'installed',
			) ?? null;
		if (installation) {
			// An installed App remains inspectable when the external catalog is unavailable.
			return { entry: null, installation };
		}
		const { catalog } = await this.readCatalog(actor, OFFICIAL_PLUGIN_SOURCE.catalogUrl, signal);
		const entry =
			catalog.packages
				.filter((item) => item.appId === OFFICIAL_PLUGIN_SOURCE.recommendedAppId && item.compatible)
				.sort((left, right) => comparePluginVersions(right.version, left.version))[0] ?? null;
		return { entry, installation: null };
	}

	recommended(actor: PluginActor): Promise<PluginRecommended> {
		return this.task((signal) => this.recommendation(actor, signal));
	}

	installRecommended(
		actor: PluginActor,
		validate: (signal: AbortSignal) => Promise<void>,
	): Promise<PluginInstallation> {
		return this.task(async (signal) => {
			await validate(signal);
			const current = await this.recommendation(actor, signal);
			if (current.installation) {
				return current.installation;
			}
			if (!current.entry) {
				throw new AgentFailure('not_found');
			}
			const stage = await this.stageEntry(
				actor,
				{
					repositoryUrl: OFFICIAL_PLUGIN_SOURCE.catalogUrl,
					appId: current.entry.appId,
					version: current.entry.version,
				},
				signal,
			);
			return this.plugins.install(actor, stage.id, stage.version);
		});
	}

	private task<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.closing || this.pending.size >= 8) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(120000)]);
		const task = this.lane.then(() => {
			if (this.closing || signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(signal);
		});
		this.lane = task.then(
			() => undefined,
			() => undefined,
		);
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			(error) => {
				this.pending.delete(task);
				if (isAgentDrainFailure(error)) {
					this.failures.record(error);
					this.quiesce();
				}
			},
		);
		return task;
	}

	quiesce(): void {
		this.closing = true;
		this.stop.abort();
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(async () => {
			await Promise.allSettled([...this.pending]);
			const failures = this.failures.errors();
			if (failures.length) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError(failures, 'Plugin repository shutdown failed'),
				});
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
