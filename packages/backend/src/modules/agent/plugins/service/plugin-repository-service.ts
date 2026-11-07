import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import type {
	PluginInstallPlanCommand,
	PluginInstallPlanResult,
	PluginInstallPlanStagedCommand,
} from '../model/plugin-install-plan-types.js';
import type { PluginPackageReference, PluginPackageInstallation } from '../model/plugin-composition-types.js';
import { isPluginInstallPlanStage } from '../model/plugin-repository-types.js';
import type { PluginInstallPlan, PluginInstallPlanDependency } from '../model/plugin-repository-types.js';
import { prerelease, satisfies } from 'semver';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';
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
import { assertPluginExecutionComposition } from '../plugin-app-composition-rules.js';

function identity(actor: PluginActor, userId: number | null): void {
	if (actor.userId !== userId) {
		throw new AgentFailure('unauthenticated');
	}
}

export class PluginRepositoryService {
	private readonly pending = new Set<Promise<unknown>>();
	private readonly stop = new AbortController();
	private lane: Promise<unknown> = Promise.resolve();
	private readonly catalogReads = new Map<string, Promise<PluginCatalog>>();
	private networkActive = 0;
	private readonly networkQueue = new Set<() => void>();
	private closing = false;
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: PluginRepositoryModel,
		private readonly plugins: PluginService,
		private readonly productVersion: string,
	) {
		if (!isAgentPluginVersion(productVersion)) {
			throw new Error('Invalid installed product version');
		}
	}

	get(actor: PluginActor): Promise<PluginRepositorySettings> {
		return this.task(() => this.model.get(actor, (userId) => identity(actor, userId)), false);
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
		const key = JSON.stringify([actor.userId, actor.token, current.version, url]);
		let read = this.catalogReads.get(key);
		if (!read) {
			read = this.networkRead(signal, async () => {
				const admitted = await this.model.get(actor, (userId) => identity(actor, userId));
				if (admitted.version !== current.version) {
					throw new AgentFailure('version_conflict');
				}
				return this.model.catalog(url, signal, (compatibility) => {
					if (comparePluginVersions(compatibility.host.minVersion, compatibility.host.maxVersion) > 0) {
						throw new AgentFailure('provider_unavailable');
					}
					if (
						comparePluginVersions(this.productVersion, compatibility.host.minVersion) < 0 ||
						comparePluginVersions(this.productVersion, compatibility.host.maxVersion) > 0
					) {
						return 'host_version';
					}
					if (
						compatibility.backendSdk !== null &&
						compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
					) {
						return 'backend_sdk';
					}
					if (
						compatibility.frontendSdk !== null &&
						compatibility.frontendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
					) {
						return 'frontend_sdk';
					}
					return null;
				});
			});
			this.catalogReads.set(key, read);

			const release = () => {
				if (this.catalogReads.get(key) === read) {
					this.catalogReads.delete(key);
				}
			};

			void read.then(release, release);
		}
		const catalog = await read;
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
		return this.task(async (signal) => (await this.readCatalog(actor, url, signal)).catalog, false);
	}

	private async stageEntry(
		actor: PluginActor,
		request: PluginCatalogStage,
		signal: AbortSignal,
	): Promise<PluginStage> {
		const { catalog, settingsVersion } = await this.readCatalog(actor, request.repositoryUrl, signal);
		const entry = catalog.packages.find(
			(item) =>
				item.packageId === request.packageId &&
				item.version === request.version &&
				item.publisherKeyId === request.publisherKeyId,
		);
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
			{ packageId: entry.packageId, version: entry.version, publisherKeyId: entry.publisherKeyId },
			async (taskSignal) => {
				const lifetime = AbortSignal.any([signal, taskSignal]);
				const bytes = await this.networkRead(lifetime, () => this.model.download(entry, lifetime));
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
				{
					repositoryUrl: input.repositoryUrl,
					packageId: input.packageId,
					version: input.version,
					publisherKeyId: input.publisherKeyId,
				},
				signal,
			);
		});
	}

	private async prepareInstallation(
		actor: PluginActor,
		request: PluginCatalogStage,
		signal: AbortSignal,
	): Promise<PluginInstallPlan> {
		const initial = await this.model.get(actor, (userId) => identity(actor, userId));
		const stage = await this.stageEntry(actor, request, signal);
		if (!isPluginInstallPlanStage(stage)) {
			throw new AgentFailure('forbidden');
		}
		const dependencies: PluginInstallPlanDependency[] = [];
		const installedPackages = await this.plugins.packageInstallations(actor);
		const versions = await this.plugins.versions(actor);
		const publishers = await this.plugins.publishers(actor);
		const catalogs = new Map<string, PluginCatalog>();
		const selected = new Map<string, { manifest: typeof stage.manifest; package: PluginPackageReference }>([
			[
				stage.manifest.id,
				{
					manifest: stage.manifest,
					package: {
						packageId: stage.manifest.id,
						version: stage.manifest.version,
						packageHash: stage.packageHash,
						publisherKeyId: stage.publisherKeyId,
					},
				},
			],
		]);
		const pending = [...stage.manifest.dependencies];
		for (let index = 0; index < pending.length; index += 1) {
			const requirement = pending[index];
			if (!requirement) {
				throw new AgentFailure('version_conflict');
			}
			const resolved = selected.get(requirement.packageId);
			if (resolved) {
				if (
					resolved.package.publisherKeyId !== requirement.publisherKeyId ||
					!satisfies(resolved.package.version, '>=' + requirement.minVersion + ' <=' + requirement.maxVersion)
				) {
					throw new AgentFailure('version_conflict');
				}
				continue;
			}
			const installed = installedPackages.find((item) => item.package.packageId === requirement.packageId);
			if (installed && installed.package.publisherKeyId !== requirement.publisherKeyId) {
				throw new AgentFailure('version_conflict');
			}
			if (installed?.status === 'installed') {
				if (
					!satisfies(
						installed.package.version,
						'>=' + requirement.minVersion + ' <=' + requirement.maxVersion,
					)
				) {
					throw new AgentFailure('version_conflict');
				}
				const version = versions.find(
					(item) =>
						item.packageHash === installed.package.packageHash &&
						item.publisherKeyId === requirement.publisherKeyId,
				);
				if (!version) {
					throw new AgentFailure('version_conflict');
				}
				if (
					!publishers.some(
						(publisher) => publisher.keyId === requirement.publisherKeyId && publisher.revokedAt === null,
					)
				) {
					throw new AgentFailure('forbidden');
				}
				dependencies.push({ kind: 'installed', installation: installed, manifest: version.manifest });
				selected.set(requirement.packageId, { manifest: version.manifest, package: installed.package });
				pending.push(...version.manifest.dependencies);
				continue;
			}
			if (installed && installed.status !== 'removed') {
				throw new AgentFailure('version_conflict');
			}
			if (!catalogs.has(request.repositoryUrl)) {
				catalogs.set(
					request.repositoryUrl,
					(await this.readCatalog(actor, request.repositoryUrl, signal)).catalog,
				);
			}

			const matches = () =>
				[...catalogs.entries()].flatMap(([repositoryUrl, catalog]) =>
					catalog.packages
						.filter(
							(entry) =>
								entry.packageId === requirement.packageId &&
								entry.publisherKeyId === requirement.publisherKeyId &&
								entry.compatible &&
								prerelease(entry.version) === null &&
								comparePluginVersions(entry.version, requirement.minVersion) >= 0 &&
								comparePluginVersions(entry.version, requirement.maxVersion) <= 0,
						)
						.map((entry) => ({ repositoryUrl, entry })),
				);

			if (matches().length === 0) {
				const sources = [
					...new Set([
						...(requirement.publisherKeyId === OFFICIAL_PLUGIN_SOURCE.publisherKeyId
							? [OFFICIAL_PLUGIN_SOURCE.catalogUrl]
							: []),
						...initial.repositories.map((source) => source.url),
					]),
				].filter((source) => !catalogs.has(source));
				const results = await Promise.allSettled(
					sources.map(async (source) => ({
						source,
						catalog: (await this.readCatalog(actor, source, signal)).catalog,
					})),
				);
				for (const result of results) {
					if (result.status === 'rejected') {
						throw result.reason;
					}
					catalogs.set(result.value.source, result.value.catalog);
				}
			}
			const candidates = matches().sort((left, right) =>
				comparePluginVersions(right.entry.version, left.entry.version),
			);
			const immutable = new Map<string, string>();
			for (const candidate of candidates) {
				const hash = immutable.get(candidate.entry.version);
				if (hash && hash !== candidate.entry.sha256) {
					throw new AgentFailure('version_conflict');
				}
				immutable.set(candidate.entry.version, candidate.entry.sha256);
			}
			const candidate = candidates[0];
			if (!candidate) {
				throw new AgentFailure('not_found');
			}
			if (
				!publishers.some(
					(publisher) => publisher.keyId === requirement.publisherKeyId && publisher.revokedAt === null,
				)
			) {
				throw new AgentFailure('forbidden');
			}
			const dependencyStage = await this.stageEntry(
				actor,
				{
					repositoryUrl: candidate.repositoryUrl,
					packageId: requirement.packageId,
					publisherKeyId: requirement.publisherKeyId,
					version: candidate.entry.version,
				},
				signal,
			);
			if (dependencyStage.packageHash !== candidate.entry.sha256 || !isPluginInstallPlanStage(dependencyStage)) {
				throw new AgentFailure('version_conflict');
			}
			dependencies.push({
				kind: 'staged',
				repositoryUrl: candidate.repositoryUrl,
				stage: dependencyStage,
				expectedInstallationRevision: installed?.revision ?? null,
			});
			selected.set(requirement.packageId, {
				manifest: dependencyStage.manifest,
				package: {
					packageId: dependencyStage.manifest.id,
					version: dependencyStage.manifest.version,
					packageHash: dependencyStage.packageHash,
					publisherKeyId: dependencyStage.publisherKeyId,
				},
			});
			pending.push(...dependencyStage.manifest.dependencies);
		}
		if (stage.manifest.contributions.app) {
			assertPluginExecutionComposition(stage.manifest, [
				{
					manifest: stage.manifest,
					package: {
						packageId: stage.manifest.id,
						version: stage.manifest.version,
						packageHash: stage.packageHash,
						publisherKeyId: stage.publisherKeyId,
					},
				},
				...dependencies.map((dependency) =>
					dependency.kind === 'installed'
						? { manifest: dependency.manifest, package: dependency.installation.package }
						: {
								manifest: dependency.stage.manifest,
								package: {
									packageId: dependency.stage.manifest.id,
									version: dependency.stage.manifest.version,
									packageHash: dependency.stage.packageHash,
									publisherKeyId: dependency.stage.publisherKeyId,
								},
							},
				),
			]);
		}
		const latest = await this.model.get(actor, (userId) => identity(actor, userId));
		if (latest.version !== initial.version || signal.aborted) {
			throw new AgentFailure(signal.aborted ? 'provider_unavailable' : 'version_conflict');
		}
		return {
			repositoryVersion: initial.version,
			target: {
				repositoryUrl: request.repositoryUrl,
				stage,
				expectedInstallationRevision:
					installedPackages.find((item) => item.package.packageId === stage.manifest?.id)?.revision ?? null,
			},
			dependencies,
		};
	}

	prepare(
		actor: PluginActor,
		produce: (signal: AbortSignal) => Promise<PluginCatalogStage>,
	): Promise<PluginInstallPlan> {
		return this.task(async (signal) => this.prepareInstallation(actor, await produce(signal), signal));
	}

	private samePackage(left: PluginPackageReference, right: PluginPackageReference): boolean {
		return (
			left.packageId === right.packageId &&
			left.publisherKeyId === right.publisherKeyId &&
			left.version === right.version &&
			left.packageHash === right.packageHash
		);
	}

	private async applyInstallation(
		actor: PluginActor,
		command: PluginInstallPlanCommand,
		signal: AbortSignal,
	): Promise<PluginInstallPlanResult> {
		const packages = await this.plugins.packageInstallations(actor);
		const publishers = await this.plugins.publishers(actor);
		const versions = await this.plugins.versions(actor);
		const stagedCommands: PluginInstallPlanStagedCommand[] = [
			command.target,
			...command.dependencies.flatMap((dependency) => (dependency.kind === 'staged' ? [dependency] : [])),
		];
		const settings = await this.model.get(actor, (userId) => identity(actor, userId));
		if (settings.version !== command.repositoryVersion) {
			throw new AgentFailure('version_conflict');
		}
		if (
			stagedCommands.some(
				(input) =>
					input.repositoryUrl !== OFFICIAL_PLUGIN_SOURCE.catalogUrl &&
					!settings.repositories.some((source) => source.url === input.repositoryUrl),
			)
		) {
			throw new AgentFailure('forbidden');
		}
		const stages = await Promise.all(
			stagedCommands.map(async (input) => {
				const stage = await this.plugins.getStage(actor, input.stageId);
				if (
					!stage.manifest ||
					stage.publisherKeyId === null ||
					stage.version !== input.expectedVersion ||
					(stage.status !== 'verified' && stage.status !== 'installed') ||
					!this.samePackage(input.package, {
						packageId: stage.manifest.id,
						version: stage.manifest.version,
						packageHash: stage.packageHash,
						publisherKeyId: stage.publisherKeyId,
					})
				) {
					throw new AgentFailure('version_conflict');
				}
				const current = packages.find((item) => item.package.packageId === input.package.packageId);
				if (
					(current?.revision ?? null) !== input.expectedInstallationRevision ||
					(current && current.package.publisherKeyId !== input.package.publisherKeyId)
				) {
					throw new AgentFailure('version_conflict');
				}
				if (
					current?.status === 'installed' &&
					comparePluginVersions(input.package.version, current.package.version) < 0
				) {
					throw new AgentFailure('version_conflict');
				}
				return { input, stage, manifest: stage.manifest };
			}),
		);
		const target = stages.find((item) => item.input.stageId === command.target.stageId);
		if (!target) {
			throw new AgentFailure('invalid_input');
		}
		const dependencies = command.dependencies.map((dependency) => {
			if (dependency.kind === 'staged') {
				const staged = stages.find((item) => item.input.stageId === dependency.stageId);
				if (!staged) {
					throw new AgentFailure('invalid_input');
				}
				return { package: dependency.package, manifest: staged.manifest };
			}
			const installed = packages.find((item) => item.package.packageId === dependency.package.packageId);
			const version = versions.find(
				(item) =>
					item.packageHash === dependency.package.packageHash &&
					item.publisherKeyId === dependency.package.publisherKeyId,
			);
			if (
				!installed ||
				installed.status !== 'installed' ||
				installed.revision !== dependency.expectedRevision ||
				!this.samePackage(installed.package, dependency.package) ||
				!version
			) {
				throw new AgentFailure('version_conflict');
			}
			return { package: dependency.package, manifest: version.manifest };
		});
		const requirements = [target.manifest, ...dependencies.map((item) => item.manifest)].flatMap(
			(manifest) => manifest.dependencies,
		);
		if (target.manifest.contributions.app) {
			assertPluginExecutionComposition(target.manifest, [
				{ package: command.target.package, manifest: target.manifest },
				...dependencies,
			]);
		}
		if (
			requirements.some(
				(requirement) =>
					![{ package: command.target.package }, ...dependencies].some(
						(dependency) =>
							dependency.package.packageId === requirement.packageId &&
							dependency.package.publisherKeyId === requirement.publisherKeyId &&
							satisfies(
								dependency.package.version,
								'>=' + requirement.minVersion + ' <=' + requirement.maxVersion,
							),
					),
			)
		) {
			throw new AgentFailure('version_conflict');
		}
		for (const selected of [{ package: command.target.package, manifest: target.manifest }, ...dependencies]) {
			if (
				!publishers.some(
					(publisher) => publisher.keyId === selected.package.publisherKeyId && publisher.revokedAt === null,
				)
			) {
				throw new AgentFailure('forbidden');
			}
			const compatibility = selected.manifest.compatibility;
			if (
				(compatibility.backendSdk !== null && compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
				(compatibility.frontendSdk !== null &&
					compatibility.frontendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
				comparePluginVersions(this.productVersion, compatibility.host.minVersion) < 0 ||
				comparePluginVersions(this.productVersion, compatibility.host.maxVersion) > 0
			) {
				throw new AgentFailure('version_conflict');
			}
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const dependencyRevisions = new Map(
			command.dependencies.flatMap((dependency) =>
				dependency.kind === 'installed'
					? [[dependency.package.packageId, dependency.expectedRevision] as const]
					: [],
			),
		);
		for (const staged of stages.filter((item) => item.input.stageId !== command.target.stageId)) {
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			const installedDependency = await this.plugins.installPackage(
				actor,
				staged.stage.id,
				staged.stage.version,
				{
					expectedRevision: staged.input.expectedInstallationRevision,
				},
			);
			dependencyRevisions.set(installedDependency.package.packageId, installedDependency.revision);
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const current = packages.find((item) => item.package.packageId === command.target.package.packageId);
		let installation: PluginPackageInstallation;
		if (
			(current?.status === 'installed' || current?.status === 'draining') &&
			!this.samePackage(current.package, command.target.package)
		) {
			const referencedApp =
				target.manifest.contributions.app !== null &&
				(await this.plugins.appBindings(actor)).some((binding) =>
					this.samePackage(binding.app, current.package),
				);
			const prepared = await this.plugins.preparePackageUpdate(
				actor,
				current.package.packageId,
				current.revision,
				target.stage.id,
				target.stage.version,
			);
			if (
				prepared.dependencies.some((dependency) => {
					const confirmed = dependencies.find(
						(item) => item.package.packageId === dependency.package.packageId,
					);
					if (confirmed) {
						return (
							!this.samePackage(confirmed.package, dependency.package) ||
							dependencyRevisions.get(dependency.package.packageId) !== dependency.installationRevision
						);
					}
					const original = packages.find((item) => item.package.packageId === dependency.package.packageId);
					return (
						!original ||
						original.status !== 'installed' ||
						!this.samePackage(original.package, dependency.package) ||
						original.revision !== dependency.installationRevision
					);
				}) ||
				(referencedApp &&
					dependencies.some(
						(dependency) =>
							!prepared.dependencies.some((item) => this.samePackage(item.package, dependency.package)),
					))
			) {
				throw new AgentFailure('version_conflict');
			}
			installation = await this.plugins.updatePackage(
				actor,
				current.package.packageId,
				prepared.installation.revision,
				target.stage.id,
				target.stage.version,
				prepared.dependencies,
			);
		} else {
			installation = await this.plugins.installPackage(actor, target.stage.id, target.stage.version, {
				expectedRevision: command.target.expectedInstallationRevision,
			});
		}
		if (target.manifest.contributions.app === null) {
			return { installation, binding: null };
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const existing = (await this.plugins.appBindings(actor)).find((item) =>
			this.samePackage(item.app, command.target.package),
		);
		const historical = existing
			? undefined
			: (await this.plugins.installations(actor))
					.filter(
						(item) =>
							item.status === 'removed' &&
							item.definitionId === command.target.package.packageId &&
							item.publisherKeyId === command.target.package.publisherKeyId,
					)
					.sort((left, right) => right.updatedAt - left.updatedAt)[0];
		const expectedPackages = [command.target.package, ...dependencies.map((dependency) => dependency.package)];
		const binding = existing
			? await this.plugins.composeApp(actor, command.target.package.packageId, {
					enableWithDeclaredGrants: false,
					appId: existing.appId,
					expectedPackages,
				})
			: await this.plugins.composeApp(actor, command.target.package.packageId, {
					enableWithDeclaredGrants: command.initialization === 'declared_grants',
					...(historical ? { appId: historical.appId } : {}),
					expectedPackages,
				});
		return { installation, binding };
	}

	installPlan(
		actor: PluginActor,
		produce: (signal: AbortSignal) => Promise<PluginInstallPlanCommand>,
		recommended = false,
	): Promise<PluginInstallPlanResult> {
		return this.task(async (signal) => {
			const command = await produce(signal);
			if (recommended) {
				if (
					command.initialization !== 'declared_grants' ||
					command.target.repositoryUrl !== OFFICIAL_PLUGIN_SOURCE.catalogUrl ||
					command.target.package.packageId !== OFFICIAL_PLUGIN_SOURCE.recommendedAppId ||
					command.target.package.publisherKeyId !== OFFICIAL_PLUGIN_SOURCE.publisherKeyId
				) {
					throw new AgentFailure('forbidden');
				}
			} else if (command.initialization !== 'disabled') {
				throw new AgentFailure('forbidden');
			}
			return this.applyInstallation(actor, command, signal);
		});
	}

	private async recommendation(actor: PluginActor, signal: AbortSignal): Promise<PluginRecommended> {
		const installation =
			(await this.plugins.installations(actor)).find(
				(item) =>
					item.definitionId === OFFICIAL_PLUGIN_SOURCE.recommendedAppId &&
					item.publisherKeyId === OFFICIAL_PLUGIN_SOURCE.publisherKeyId &&
					item.status === 'installed',
			) ?? null;
		if (installation) {
			// An installed App remains inspectable when the external catalog is unavailable.
			return { entry: null, installation };
		}
		const { catalog } = await this.readCatalog(actor, OFFICIAL_PLUGIN_SOURCE.catalogUrl, signal);
		const entry =
			catalog.packages
				.filter(
					(item) =>
						item.packageId === OFFICIAL_PLUGIN_SOURCE.recommendedAppId &&
						item.compatible &&
						item.contributionKinds.includes('app') &&
						prerelease(item.version) === null,
				)
				.sort((left, right) => comparePluginVersions(right.version, left.version))[0] ?? null;
		return { entry, installation: null };
	}

	recommended(actor: PluginActor): Promise<PluginRecommended> {
		return this.task((signal) => this.recommendation(actor, signal), false);
	}

	existingRecommended(actor: PluginActor, appId: string, expectedRevision: number): Promise<PluginInstallation> {
		return this.task(async () => {
			const installation = (await this.plugins.installations(actor)).find(
				(item) =>
					item.appId === appId &&
					item.definitionId === OFFICIAL_PLUGIN_SOURCE.recommendedAppId &&
					item.publisherKeyId === OFFICIAL_PLUGIN_SOURCE.publisherKeyId &&
					item.status === 'installed',
			);
			if (!installation) {
				throw new AgentFailure('not_found');
			}
			if (installation.revision !== expectedRevision) {
				throw new AgentFailure('version_conflict');
			}
			return installation;
		}, false);
	}

	private async networkRead<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
		await new Promise<void>((resolve, reject) => {
			const cancel = () => {
				this.networkQueue.delete(start);
				signal.removeEventListener('abort', cancel);
				reject(new AgentFailure('provider_unavailable'));
			};

			const start = () => {
				signal.removeEventListener('abort', cancel);
				this.networkQueue.delete(start);
				this.networkActive += 1;
				resolve();
			};

			if (signal.aborted) {
				cancel();
				return;
			}
			if (this.networkActive < 8) {
				start();
				return;
			}
			this.networkQueue.add(start);
			signal.addEventListener('abort', cancel, { once: true });
		});
		try {
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return await work();
		} finally {
			this.networkActive -= 1;
			this.networkQueue.values().next().value?.();
		}
	}

	private task<T>(work: (signal: AbortSignal) => Promise<T>, serialized = true): Promise<T> {
		if (this.closing) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(120000)]);
		const task = (serialized ? this.lane : Promise.resolve()).then(() => {
			if (this.closing || signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(signal);
		});
		if (serialized) {
			this.lane = task.then(
				() => undefined,
				() => undefined,
			);
		}
		this.pending.add(task);
		void task.then(
			() => {
				this.pending.delete(task);
			},
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
