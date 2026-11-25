import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import pLimit from 'p-limit';
import { z } from 'zod';
import type { AuthApi } from '../../auth/node/auth-api.js';
import type { BackupPackage } from '../../backup/backup-types.js';
import type { BackupDataApi } from '../../backup/node/backup-data-api.js';
import type { PluginDatabaseApi } from '../../database/node/database-plugin-api.js';
import { HttpFailure, type HttpRoute, type PluginHttpApi } from '../../http/node/http-plugin-api.js';
import type { HttpApi } from '../../http/node/http-api.js';
import type { PluginLogApi } from '../../log/log-plugin-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import type { PluginStateApi } from '../../state/node/state-plugin-api.js';
import {
	inspectPluginPackage,
	type InstalledPluginStartFailure,
	type PluginRuntimeApi,
} from '../../plugin/plugin-api.node.js';
import { CodedError } from '../../utils/error.js';
import {
	MarketplaceClearDataSchema,
	MarketplaceInstallAttemptsSchema,
	MarketplaceConfirmInstallSchema,
	MarketplaceRetainedDataListSchema,
	MarketplaceReloadSchema,
	MarketplaceRuntimeImpactSchema,
	MarketplaceUninstallPlanSchema,
	MarketplaceUninstallSchema,
	MarketplaceOperationListSchema,
	MarketplaceOperationParamsSchema,
	MarketplacePlanInstallSchema,
	MarketplacePluginListSchema,
	MarketplacePluginParamsSchema,
	MarketplaceSetEnabledSchema,
} from '../marketplace-http-types.js';
import {
	MarketplaceInstallPlanSchema,
	type MarketplaceInstallPlan,
	type MarketplaceRepositorySource,
} from '../marketplace-install-types.js';
import {
	MarketplaceOperationSchema,
	MarketplacePluginIssueSchema,
	MarketplacePluginSchema,
	type MarketplacePlugin,
	type MarketplacePluginIssue,
	type MarketplaceOperation,
} from '../marketplace-types.js';
import { planBackupPackages, type BackupOwner, type MarketplaceBackupPlan } from './marketplace-backup.js';
import { MarketplaceCatalog } from './marketplace-catalog.js';
import { MarketplaceFrontends } from './marketplace-frontends.js';
import { affectedInstalled, planMarketplaceInstall, type InstalledPackage } from './marketplace-install-planner.js';
import { MarketplaceOperations, type MarketplaceOperationScope } from './marketplace-operations.js';
import { MarketplacePackages } from './marketplace-packages.js';
import { installedSource, MarketplaceStorage, type InstalledPlugin } from './marketplace-storage.js';

const empty = z.strictObject({});

export type MarketplaceRuntime = Pick<
	PluginRuntimeApi,
	'startInstalled' | 'prepareInstalled' | 'getInstalled' | 'get' | 'stop' | 'removeInstalled'
>;

interface MarketplaceOptions {
	readonly scope: PluginScopeApi;
	readonly directory: string;
	readonly services: {
		readonly runtime: MarketplaceRuntime;
		readonly database: PluginDatabaseApi;
		readonly log: PluginLogApi;
		readonly state: PluginStateApi;
		readonly auth: Pick<AuthApi, 'loginProviders'>;
		readonly backupData: Pick<BackupDataApi, 'clearPluginData'>;
	};
}

function startIssue({ stage, cause }: InstalledPluginStartFailure): MarketplacePluginIssue {
	if (stage === 'activate') return 'MARKETPLACE_PLUGIN_START_FAILED';
	const code = (cause as NodeJS.ErrnoException | undefined)?.code;
	switch (code) {
		case 'ENOENT':
		case 'ENOTDIR':
			return 'MARKETPLACE_PACKAGE_MISSING';
		case 'PLUGIN_INSTALLED_IDENTITY_MISMATCH':
			return 'MARKETPLACE_PACKAGE_IDENTITY_MISMATCH';
		case 'PLUGIN_ALREADY_STARTED':
		case 'PLUGIN_BUILTIN_ID_RESERVED':
			return 'MARKETPLACE_RUNTIME_CONFLICT';
		default:
			return 'MARKETPLACE_PACKAGE_INVALID';
	}
}

async function inspectInstalled(record: InstalledPlugin): Promise<InstalledPackage> {
	try {
		const target = await inspectPluginPackage(record.directory, record);
		return { record, manifest: target.package };
	} catch {
		// 目录可能已丢失，保留记录用于阻止计划静默换源。
		return { record, manifest: undefined };
	}
}

function revision(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 管理安装记录及启用意图。插件实例、依赖和清理由运行时负责。 */
export class MarketplaceApi {
	readonly #runtime: MarketplaceOptions['services']['runtime'];
	readonly #storage: MarketplaceStorage;
	readonly #packages: MarketplacePackages;
	readonly #backupData: Pick<BackupDataApi, 'clearPluginData'>;
	readonly #catalog: MarketplaceCatalog;
	readonly #frontends: MarketplaceFrontends;
	readonly #log: PluginLogApi;
	readonly #operations: MarketplaceOperations;
	readonly #scope: PluginScopeApi;
	readonly #serial = pLimit(1);
	readonly #pending = new Set<Promise<unknown>>();
	readonly #issues = new Map<string, MarketplacePluginIssue>();
	#closing: Promise<void> | undefined;

	constructor({
		scope,
		directory,
		services: { runtime, database, log, state, auth, backupData },
	}: MarketplaceOptions) {
		this.#runtime = runtime;
		this.#scope = scope;
		this.#storage = new MarketplaceStorage(database);
		this.#packages = new MarketplacePackages(directory);
		this.#backupData = backupData;
		this.#catalog = new MarketplaceCatalog(this.#storage, (operation) => this.#change(operation));
		this.#frontends = new MarketplaceFrontends(scope, { state, log, auth, runtime });
		this.#log = log;
		this.#operations = new MarketplaceOperations(state, log, scope.signal, (execute) => this.#change(execute));
	}

	register(http: PluginHttpApi, hostHttp: Pick<HttpApi, 'register'>): void {
		this.#assertOpen();
		http.register([
			{
				method: 'get',
				path: '/manager/plugins',
				input: empty,
				output: MarketplacePluginListSchema,
				handler: this.#listPlugins,
			},
			{
				method: 'get',
				path: '/manager/plugins/:pluginId',
				input: MarketplacePluginParamsSchema,
				output: MarketplacePluginSchema,
				handler: this.#getPlugin,
			},
			{
				method: 'patch',
				path: '/manager/plugins/:pluginId',
				input: MarketplaceSetEnabledSchema,
				output: MarketplaceOperationSchema,
				status: 202,
				handler: this.#updateEnabled,
			},
			{
				method: 'get',
				path: '/manager/operations',
				input: empty,
				output: MarketplaceOperationListSchema,

				handler: () => ({ items: this.#operations.list() }),
			},
			{
				method: 'get',
				path: '/manager/operations/:operationId',
				input: MarketplaceOperationParamsSchema,
				output: MarketplaceOperationSchema,
				handler: this.#getOperation,
			},
			{
				method: 'post',
				path: '/manager/install-plan',
				input: MarketplacePlanInstallSchema,
				output: MarketplaceInstallPlanSchema,
				handler: this.#planInstall,
			},
			{
				method: 'post',
				path: '/manager/install',
				input: MarketplaceConfirmInstallSchema,
				output: MarketplaceOperationSchema,
				status: 202,

				handler: (
					{ plan, observationId }: z.infer<typeof MarketplaceConfirmInstallSchema>,
					signal: AbortSignal,
				) => {
					signal.throwIfAborted();
					this.#assertOpen();
					const change = {
						action: 'install' as const,
						pluginId: plan.target.pluginId,
						target: plan.target,
						revision: revision(plan),
					};
					return this.#submit(change, observationId, (scope) => this.#install(plan, scope));
				},
			},
			{
				method: 'get',
				path: '/manager/plugins/:pluginId/uninstall-plan',
				input: MarketplacePluginParamsSchema,
				output: MarketplaceUninstallPlanSchema,

				handler: async ({ pluginId }: z.infer<typeof MarketplacePluginParamsSchema>, signal: AbortSignal) =>
					this.#uninstallPlan(await this.#installed(pluginId), signal),
			},
			{
				method: 'get',
				path: '/manager/plugins/:pluginId/runtime-impact',
				input: MarketplacePluginParamsSchema,
				output: MarketplaceRuntimeImpactSchema,

				handler: async ({ pluginId }: z.infer<typeof MarketplacePluginParamsSchema>, signal: AbortSignal) => {
					const { required: _required, ...impact } = await this.#uninstallPlan(
						await this.#installed(pluginId),
						signal,
					);
					return impact;
				},
			},
			{
				method: 'post',
				path: '/manager/uninstall',
				input: MarketplaceUninstallSchema,
				output: MarketplaceOperationSchema,
				status: 202,

				handler: (
					{ observationId, ...input }: z.infer<typeof MarketplaceUninstallSchema>,
					signal: AbortSignal,
				) => {
					signal.throwIfAborted();
					return this.#submit({ action: 'uninstall', ...input }, observationId, ({ commit }) =>
						this.#uninstall(input, commit),
					);
				},
			},
			{
				method: 'get',
				path: '/manager/retained-data',
				input: empty,
				output: MarketplaceRetainedDataListSchema,

				handler: async () => ({ items: await this.#storage.listRetained() }),
			},
			{
				method: 'post',
				path: '/manager/clear-data',
				input: MarketplaceClearDataSchema,
				output: MarketplaceOperationSchema,
				status: 202,

				handler: (
					{ observationId, pluginId }: z.infer<typeof MarketplaceClearDataSchema>,
					signal: AbortSignal,
				) => {
					signal.throwIfAborted();
					return this.#submit({ action: 'clear-data', pluginId }, observationId, async ({ commit }) => {
						await this.#clearData(pluginId);
						commit();
					});
				},
			},
			{
				method: 'post',
				path: '/manager/reload',
				input: MarketplaceReloadSchema,
				output: MarketplaceOperationSchema,
				status: 202,

				handler: (
					{ pluginId, observationId, impactRevision }: z.infer<typeof MarketplaceReloadSchema>,
					signal: AbortSignal,
				) => {
					signal.throwIfAborted();
					return this.#submit(
						{ action: 'reload', pluginId, impactRevision },
						observationId,
						async ({ commit }) => {
							const record = await this.#installed(pluginId);
							if (!record.enabled) throw new CodedError('MARKETPLACE_PLUGIN_DISABLED');
							if ((await this.#uninstallPlan(record, this.#scope.signal)).revision !== impactRevision)
								throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');
							this.#assertOpen();
							this.#frontends.remove(pluginId);
							await this.#runtime.removeInstalled(record);
							await this.#start([record], true);
							const issue = this.#issues.get(pluginId);
							if (issue) throw new CodedError(issue);
							commit();
						},
					);
				},
			},
			{
				method: 'get',
				path: '/manager/install-attempts',
				input: empty,
				output: MarketplaceInstallAttemptsSchema,

				handler: async () => ({ items: await this.#storage.listAttempts() }),
			},
			{
				method: 'delete',
				path: '/manager/install-attempts/:pluginId',
				input: MarketplacePluginParamsSchema,
				output: empty,
				status: 204,

				handler: async ({ pluginId }: z.infer<typeof MarketplacePluginParamsSchema>, signal: AbortSignal) => {
					await this.#change(async () => {
						signal.throwIfAborted();
						await this.#storage.removeAttempt(pluginId);
					});
					return {};
				},
			},
		] as const);
		this.#catalog.register(http);
		this.#frontends.register(hostHttp);
	}

	/** 批量交付已启用的包，由运行时按依赖顺序激活。 */
	restore(): Promise<void> {
		return this.#change(async () => {
			await this.#storage.interruptAttempts();
			const installed = await this.#storage.list();
			try {
				await this.#packages.collect(
					installed.map(({ directory }) => directory),
					this.#scope.signal,
				);
			} catch {
				this.#assertOpen();
				this.#log.report({ level: 'warn', code: 'MARKETPLACE_PACKAGE_CLEANUP_FAILED' });
			}
			await this.#start(installed.filter(({ enabled }) => enabled));
		});
	}

	async describeBackup(owners: readonly BackupOwner[], signal: AbortSignal): Promise<BackupPackage[]> {
		const records = new Map((await this.#storage.list()).map((item) => [item.pluginId, item]));
		const { repositories } = await this.#catalog.snapshot();
		const packages = new Map<string, BackupPackage>();
		const remaining = [...owners];
		while (remaining.length) {
			signal.throwIfAborted();
			const { pluginId, pluginVersion } = remaining.pop()!;
			const record = records.get(pluginId);
			if (!record) continue;
			if (record.version !== pluginVersion) throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
			if (packages.has(pluginId)) continue;
			const { manifest } = await inspectInstalled(record);
			if (!manifest) continue;
			const dependsOn = manifest.nexus.dependsOn ?? {};
			const repositoryUrl = repositories.find(({ id }) => id === record.repositoryId)?.url;
			packages.set(pluginId, { pluginId, pluginVersion, repositoryUrl, dependsOn, enabled: record.enabled });
			for (const id of Object.keys(dependsOn)) {
				const dependency = records.get(id);
				if (dependency) remaining.push({ pluginId: id, pluginVersion: dependency.version });
			}
		}
		signal.throwIfAborted();
		return [...packages.values()];
	}

	async planBackup(
		owners: readonly BackupOwner[],
		packages: readonly BackupPackage[],
		signal: AbortSignal,
	): Promise<MarketplaceBackupPlan> {
		this.#assertOpen();
		signal.throwIfAborted();
		const [snapshot, records, retained] = await Promise.all([
			this.#catalog.snapshot(),
			this.#storage.list(),
			this.#storage.listRetained(),
		]);
		const limit = pLimit(8);
		const installed = await Promise.all(
			records.map((record) =>
				limit(async () => {
					signal.throwIfAborted();
					return inspectInstalled(record);
				}),
			),
		);
		signal.throwIfAborted();
		const plan = planBackupPackages(owners, packages, installed, snapshot.repositories, snapshot.catalog);
		for (const record of plan.present) {
			if (this.#runtime.get(record.pluginId) && !this.#runtime.getInstalled(record))
				throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
		}
		for (const { step } of plan.installs) {
			const { name, version } = step.package;
			if (this.#runtime.get(name) || retained.some((item) => item.pluginId === name && item.version !== version))
				throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
		}
		return plan;
	}

	/** 与市场变更串行。仅暂停实际写入数据的插件，缺失的包在数据提交前不交给激活。 */
	restoreBackup<Result>(
		owners: readonly BackupOwner[],
		packages: readonly BackupPackage[],
		confirmed: MarketplaceBackupPlan,
		restore: (signal: AbortSignal) => Promise<Result>,
		signal: AbortSignal,
	): Promise<Result> {
		return this.#change(async () => {
			const lifetime = AbortSignal.any([signal, this.#scope.signal]);
			const plan = await this.planBackup(owners, packages, lifetime);
			if (!isDeepStrictEqual(plan, confirmed)) throw new CodedError('BACKUP_RESTORE_PLAN_CHANGED');

			const resume: InstalledPlugin[] = [];
			const prepared: { directory: string; pluginId: string; record?: InstalledPlugin }[] = [];
			let restored = false;
			try {
				for (const owner of owners) {
					const record = plan.present.find(({ pluginId }) => pluginId === owner.pluginId);
					if (!record) continue;
					if (record.enabled) resume.push(record);
					this.#frontends.remove(record.pluginId);
					if (this.#runtime.getInstalled(record)) await this.#runtime.stop(record.pluginId);
				}

				for (const { step } of plan.installs) {
					lifetime.throwIfAborted();
					const source = step.source;
					if (this.#runtime.get(source.pluginId)) throw new CodedError('BACKUP_PLUGIN_VERSION_CONFLICT');
					const directory = await this.#packages.prepare(step, lifetime);
					const item: (typeof prepared)[number] = { directory, pluginId: source.pluginId };
					prepared.push(item);
					const target = { pluginId: source.pluginId, version: source.version, directory };
					await this.#runtime.prepareInstalled(target, lifetime);
					lifetime.throwIfAborted();
					item.record = await this.#storage.commitPackage(target, source, false);
				}

				const result = await restore(lifetime);
				restored = true;
				// 先持久化启动意图，再让运行时根据依赖顺序激活整批。
				for (const { step, enabled } of plan.installs) {
					if (!enabled || lifetime.aborted) continue;
					const record = await this.#storage.setEnabled(step.package.name, true);
					if (record) resume.push(record);
				}
				return result;
			} finally {
				if (!restored) {
					// 已迁移的表按保留数据处理。重试可复用迁移，已下载的包不会提前激活。
					for (const { directory, pluginId, record } of prepared) {
						if (record) {
							try {
								await this.#storage.remove(record);
							} catch {
								this.#log.report({
									level: 'warn',
									code: 'BACKUP_PREPARED_PACKAGE_CLEANUP_FAILED',
									params: { pluginId: record.pluginId },
								});
								continue;
							}
						}
						await this.#removePackage(directory, pluginId);
					}
				}
				if (!this.#scope.signal.aborted) await this.#start(resume);
			}
		});
	}

	close(): Promise<void> {
		// 路由和主题随作用域撤销，这里只排空已受理的市场操作。
		return (this.#closing ??= Promise.allSettled(this.#pending).then(() => undefined));
	}

	readonly #planInstall: HttpRoute<
		typeof MarketplacePlanInstallSchema,
		typeof MarketplaceInstallPlanSchema
	>['handler'] = (target, signal) => this.#makePlan(target, signal);

	async #makePlan(target: MarketplaceRepositorySource, signal: AbortSignal): Promise<MarketplaceInstallPlan> {
		const [snapshot, records] = await Promise.all([this.#catalog.snapshot(), this.#storage.list()]);
		signal.throwIfAborted();

		// 只检查本地清单和入口，不导入代码。请求结束时停止尚未派发的检查。
		const limit = pLimit(8);
		const installed = await Promise.all(
			records.map((record) =>
				limit(async () => {
					if (signal.aborted) return { record, manifest: undefined };
					return inspectInstalled(record);
				}),
			),
		);
		signal.throwIfAborted();
		this.#assertOpen();
		return planMarketplaceInstall({ target, installed, ...snapshot });
	}

	readonly #listPlugins: HttpRoute<typeof empty, typeof MarketplacePluginListSchema>['handler'] = async (
		_,
		signal,
	) => {
		this.#assertOpen();
		// 列表直接读取安装记录与运行状态，无需等待市场操作完成。
		const records = await this.#storage.list();
		const read = pLimit(8);
		const items = await Promise.all(
			records.map((record) =>
				read(() => {
					signal.throwIfAborted();
					return this.#view(record);
				}),
			),
		);
		signal.throwIfAborted();
		return { items };
	};

	readonly #getPlugin: HttpRoute<typeof MarketplacePluginParamsSchema, typeof MarketplacePluginSchema>['handler'] =
		async ({ pluginId }) => this.#view(await this.#installed(pluginId));

	readonly #getOperation: HttpRoute<
		typeof MarketplaceOperationParamsSchema,
		typeof MarketplaceOperationSchema
	>['handler'] = ({ operationId }) => {
		const operation = this.#operations.get(operationId);
		if (!operation) throw new HttpFailure(404, 'MARKETPLACE_PLUGIN_OPERATION_NOT_FOUND');
		return operation;
	};

	readonly #updateEnabled: HttpRoute<
		typeof MarketplaceSetEnabledSchema,
		typeof MarketplaceOperationSchema
	>['handler'] = async ({ pluginId, enabled, observationId, impactRevision }, signal) => {
		await this.#installed(pluginId);
		signal.throwIfAborted();
		this.#assertOpen();

		// 202 只确认受理。执行进入宿主队列，浏览器断线不撤销已受理的变更。
		const change = { action: 'set-enabled', pluginId, enabled, ...(impactRevision && { impactRevision }) } as const;
		return this.#operations.submit(change, observationId, async (committed) => {
			if (
				!enabled &&
				(await this.#uninstallPlan(await this.#installed(pluginId), this.#scope.signal)).revision !==
					impactRevision
			)
				return 'MARKETPLACE_INSTALL_PLAN_CHANGED';
			this.#assertOpen();
			const result = await this.#setEnabled(pluginId, enabled, committed.commit);
			return enabled || result.issue === 'MARKETPLACE_PLUGIN_STOP_FAILED' ? result.issue : null;
		});
	};

	#submit(
		change: MarketplaceOperation['change'],
		observationId: string | undefined,
		run: (scope: MarketplaceOperationScope) => Promise<void>,
	) {
		this.#assertOpen();
		return this.#operations.submit(change, observationId, async (scope) => {
			try {
				await run(scope);
				return null;
			} catch (cause) {
				const code = MarketplacePluginIssueSchema.safeParse(
					cause instanceof CodedError ? cause.code : undefined,
				);
				this.#log.report({
					level: 'error',
					code: code.data ?? 'MARKETPLACE_OPERATION_FAILED',
					params: { pluginId: change.pluginId },
				});
				return code.data ?? 'MARKETPLACE_OPERATION_FAILED';
			}
		});
	}

	async #install(confirmed: MarketplaceInstallPlan, scope: MarketplaceOperationScope): Promise<void> {
		const signal = this.#scope.signal;
		scope.step({ phase: 'validate', pluginId: confirmed.target.pluginId });
		const current = await this.#makePlan(confirmed.target, signal);
		if (current.blockers.length || !current.steps.length || !isDeepStrictEqual(current, confirmed))
			throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');

		const { pluginId } = current.target;
		await this.#storage.startAttempt(current.target);
		try {
			await this.#applyInstall(current, scope);
		} catch (cause) {
			if (!signal.aborted) await this.#storage.failAttempt(pluginId);
			throw cause;
		}
		await this.#storage.removeAttempt(pluginId);
	}

	async #applyInstall(
		current: MarketplaceInstallPlan,
		{ commit, step: progress, completePackage }: MarketplaceOperationScope,
	): Promise<void> {
		const signal = this.#scope.signal;
		const activate: InstalledPlugin[] = [];
		let activationIssue: MarketplacePluginIssue | undefined;
		let packagesApplied = false;
		try {
			for (const step of current.steps) {
				this.#assertOpen();
				const {
					source,
					package: { name: pluginId, version },
				} = step;
				progress({ phase: step.action === 'reuse' ? 'register' : 'download', pluginId });
				if (step.action === 'reuse') {
					const reused = await this.#installed(pluginId);
					if (
						!reused.enabled &&
						current.steps.some((item) => item.action === 'install' || item.previous?.enabled)
					) {
						const enabled = await this.#storage.setEnabled(pluginId, true);
						if (enabled) {
							activate.push(enabled);
							commit();
						}
					}
					completePackage(pluginId);
					continue;
				}
				if (source.kind !== 'repository') throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');

				const previous = await this.#storage.get(pluginId);
				const runtime = this.#runtime.get(pluginId);
				if (runtime && (!previous || !this.#runtime.getInstalled(previous)))
					throw new CodedError('MARKETPLACE_RUNTIME_CONFLICT');
				if (previous?.repositoryId && previous.repositoryId !== source.repositoryId)
					throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');

				const directory = await this.#packages.prepare(step, signal);
				progress({ phase: 'register', pluginId });
				let saved: InstalledPlugin;
				try {
					this.#assertOpen();
					if (previous) {
						this.#frontends.remove(pluginId);
						await this.#runtime.removeInstalled(previous);
					}
					this.#assertOpen();
					saved = await this.#storage.commitPackage(
						{ pluginId, version, directory },
						source,
						previous?.enabled ?? true,
					);
					commit();
				} catch (cause) {
					await this.#removePackage(directory, pluginId);
					if (previous?.enabled && !signal.aborted) await this.#start([previous]);
					throw cause;
				}
				this.#issues.delete(pluginId);
				if (saved.enabled) activate.push(saved);
				if (previous) await this.#removePackage(previous.directory, pluginId);
				completePackage(pluginId);
			}
			packagesApplied = true;
		} finally {
			if (!signal.aborted && activate.length) {
				if (packagesApplied) progress({ phase: 'activate', pluginId: current.target.pluginId });
				await this.#start(activate);
			}
		}
		for (const { pluginId } of activate) activationIssue ??= this.#issues.get(pluginId);
		if (activationIssue) throw new CodedError(activationIssue);
	}

	async #uninstallPlan(
		record: InstalledPlugin,
		signal: AbortSignal,
	): Promise<z.infer<typeof MarketplaceUninstallPlanSchema>> {
		const { pluginId, version } = record;
		const installed = await this.#storage.list();
		const inspect = pLimit(8);
		const packages = await Promise.all(
			installed.map((item) =>
				inspect(async () => {
					signal.throwIfAborted();
					return inspectInstalled(item);
				}),
			),
		);
		signal.throwIfAborted();
		const own = packages.find((item) => item.record.pluginId === pluginId);
		const required = own?.manifest?.nexus.mandatory === true;
		const dependents = affectedInstalled([pluginId], packages);
		return { pluginId, version, dependents, required, revision: revision([record, dependents, required]) };
	}

	async #uninstall(input: z.infer<typeof MarketplaceUninstallSchema>, commit: () => void): Promise<void> {
		const { pluginId, data } = input;
		const record = await this.#installed(pluginId);
		const plan = await this.#uninstallPlan(record, this.#scope.signal);
		if (plan.revision !== input.revision) throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');
		if (plan.required) throw new CodedError('MARKETPLACE_PLUGIN_REQUIRED');
		this.#assertOpen();

		this.#frontends.remove(pluginId);
		try {
			await this.#runtime.removeInstalled(record);
			this.#assertOpen();
			await this.#storage.remove(record);
			commit();
		} catch (cause) {
			if (record.enabled && !this.#scope.signal.aborted) await this.#start([record]);
			throw cause;
		}
		try {
			if (data === 'clear') await this.#clearData(pluginId);
		} finally {
			this.#issues.delete(pluginId);
			await this.#removePackage(record.directory, pluginId);
		}
	}

	async #clearData(pluginId: string): Promise<void> {
		if (this.#runtime.get(pluginId) || (await this.#storage.get(pluginId)))
			throw new CodedError('MARKETPLACE_RUNTIME_CONFLICT');
		if (!(await this.#storage.listRetained()).some((item) => item.pluginId === pluginId)) return;
		try {
			await this.#backupData.clearPluginData(pluginId, this.#scope.signal);
			await this.#storage.removeRetained(pluginId);
		} catch (cause) {
			throw new CodedError('MARKETPLACE_PLUGIN_DATA_CLEAR_FAILED', { cause });
		}
	}

	async #removePackage(directory: string, pluginId: string): Promise<void> {
		try {
			await this.#packages.remove(directory);
		} catch {
			this.#log.report({ level: 'warn', code: 'MARKETPLACE_PACKAGE_CLEANUP_FAILED', params: { pluginId } });
		}
	}

	async #installed(pluginId: string): Promise<InstalledPlugin> {
		const record = await this.#storage.get(pluginId);
		if (!record) throw new HttpFailure(404, 'MARKETPLACE_PLUGIN_NOT_INSTALLED');
		return record;
	}

	async #setEnabled(pluginId: string, enabled: boolean, committed: () => void): Promise<MarketplacePlugin> {
		const record = await this.#storage.setEnabled(pluginId, enabled);
		if (!record) throw new HttpFailure(404, 'MARKETPLACE_PLUGIN_NOT_INSTALLED');
		committed();
		this.#assertOpen();

		// 启用意图已持久化。激活或清理失败通过运行状态和诊断反映。
		if (enabled) {
			await this.#start([record]);
		} else {
			this.#frontends.remove(pluginId);
			if (this.#runtime.getInstalled(record)) {
				try {
					await this.#runtime.stop(pluginId);
					if (this.#issues.get(pluginId) === 'MARKETPLACE_PLUGIN_STOP_FAILED') this.#issues.delete(pluginId);
				} catch {
					this.#issues.set(pluginId, 'MARKETPLACE_PLUGIN_STOP_FAILED');
				}
			}
		}
		return this.#view(record);
	}

	async #start(records: readonly InstalledPlugin[], reload = false): Promise<void> {
		this.#assertOpen();
		if (records.length === 0) return;
		const failures = await this.#runtime.startInstalled(records);
		this.#assertOpen();
		const admitted: InstalledPlugin[] = [];
		for (const record of records) {
			const { pluginId } = record;
			const failure = failures.get(pluginId);
			if (failure) {
				const code = startIssue(failure);
				this.#issues.set(pluginId, code);
				this.#log.report({ level: 'warn', code, params: { pluginId } });
			} else {
				this.#issues.delete(pluginId);
			}
			// 已确认安装身份的包仍能显示前端配置入口，即使后端激活失败。
			if (failure?.stage === 'load') this.#frontends.remove(pluginId);
			else admitted.push(record);
		}
		const invalid = await this.#frontends.load(admitted, reload);
		for (const id of invalid) {
			if (!this.#issues.has(id)) this.#issues.set(id, 'MARKETPLACE_FRONTEND_INVALID');
		}
	}

	async #view(record: InstalledPlugin): Promise<MarketplacePlugin> {
		const { manifest } = await inspectInstalled(record);
		const { pluginId, version, enabled, directory } = record;
		const runtime = this.#runtime.getInstalled({ pluginId, version, directory }) ?? null;
		const issue =
			this.#issues.get(pluginId) ??
			(runtime?.runtime === 'failed' && enabled ? 'MARKETPLACE_PLUGIN_START_FAILED' : null);
		const localizedNames = Object.entries(manifest?.nexus.i18n ?? {}).flatMap(([language, { displayName }]) =>
			displayName ? [[language, displayName] as const] : [],
		);
		return {
			pluginId,
			version,
			kind: manifest?.nexus.kind ?? null,
			icon: manifest?.nexus.icon,
			displayName: manifest?.displayName,
			...(localizedNames.length && { localizedNames: Object.fromEntries(localizedNames) }),
			hasBackend: manifest ? manifest.nexus.entry.backend !== undefined : null,
			source: installedSource(record),
			enabled,
			runtime,
			issue,
		};
	}

	#change<Result>(operation: () => Promise<Result>): Promise<Result> {
		this.#assertOpen();
		const pending = this.#serial(() => {
			this.#assertOpen();
			return operation();
		});
		this.#pending.add(pending);

		const settled = () => this.#pending.delete(pending);

		void pending.then(settled, settled);
		return pending;
	}

	#assertOpen(): void {
		this.#scope.signal.throwIfAborted();
		if (this.#closing) throw new CodedError('MARKETPLACE_CLOSED');
	}
}
