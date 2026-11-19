import hostPackage from '../../../package.json' with { type: 'json' };
import type { AuthApi } from '../../auth/node/auth-api.js';
import type { BackupDataApi } from '../../backup/node/backup-data-api.js';
import type { HttpApi } from '../../http/node/http-api.js';
import type { BuiltinPlugin, PluginContextApi } from '../../plugin/plugin-api.node.js';
import { CodedError } from '../../utils/error.js';
import { MarketplacePluginId } from '../marketplace-types.js';
import type { BackupPackage } from '../../backup/backup-types.js';
import type { BackupOwner, MarketplaceBackupPlan } from './marketplace-backup.js';
import { MarketplaceApi, type MarketplaceRuntime } from './marketplace-api.js';
import { marketplaceMigrations } from './marketplace-storage.js';

interface MarketplaceHostServices {
	readonly runtime: MarketplaceRuntime;
	readonly backupData: Pick<BackupDataApi, 'clearPluginData'>;
	readonly auth: Pick<AuthApi, 'loginProviders'>;
	readonly hostHttp: Pick<HttpApi, 'register'>;
}

/** 随宿主发布的市场入口。普通插件能力通过上下文交付，运行时管理由宿主授予。 */
export class MarketplacePlugin implements BuiltinPlugin {
	readonly id = MarketplacePluginId;
	readonly version = hostPackage.version;
	readonly migrations = marketplaceMigrations;
	readonly #services: MarketplaceHostServices;
	readonly #directory: string;
	#api: MarketplaceApi | undefined;

	constructor({ directory, services }: { directory: string; services: MarketplaceHostServices }) {
		this.#directory = directory;
		this.#services = services;
	}

	activate(context: PluginContextApi): void {
		const { database, log, state, http } = context.app;
		const api = new MarketplaceApi({
			scope: context,
			directory: this.#directory,
			services: {
				runtime: this.#services.runtime,
				auth: this.#services.auth,
				database,
				log,
				state,
				backupData: this.#services.backupData,
			},
		});
		context.onDispose(() => {
			this.#api = undefined;
			return api.close();
		});

		api.register(http, this.#services.hostHttp);
		this.#api = api;
		context.self.readiness.set({ state: 'ready' });
	}

	/** 外部插件启动阶段按持久化的启用状态提交已安装包。 */
	restoreInstalledPlugins(): Promise<void> {
		if (!this.#api) throw new CodedError('SERVICE_NOT_READY');
		return this.#api.restore();
	}

	describeBackup(owners: readonly BackupOwner[], signal: AbortSignal): Promise<BackupPackage[]> {
		return this.#marketplace().describeBackup(owners, signal);
	}

	planBackup(
		owners: readonly BackupOwner[],
		packages: readonly BackupPackage[],
		signal: AbortSignal,
	): Promise<MarketplaceBackupPlan> {
		return this.#marketplace().planBackup(owners, packages, signal);
	}

	restoreBackup<Result>(
		owners: readonly BackupOwner[],
		packages: readonly BackupPackage[],
		confirmed: MarketplaceBackupPlan,
		restore: (signal: AbortSignal) => Promise<Result>,
		signal: AbortSignal,
	): Promise<Result> {
		return this.#marketplace().restoreBackup(owners, packages, confirmed, restore, signal);
	}

	#marketplace(): MarketplaceApi {
		if (!this.#api) throw new CodedError('SERVICE_NOT_READY');
		return this.#api;
	}
}
