import type { MigrationProvider } from 'kysely/migration';
import type { BackupDeclaration } from '../backup/backup-types.js';
import type { AuthMethodApi } from '../auth/node/auth-method-api.js';
import type { PluginCryptoApi } from '../crypto/node/crypto-plugin-api.js';
import type { PluginDatabaseApi } from '../database/node/database-plugin-api.js';
import type { PluginHttpApi } from '../http/node/http-plugin-api.js';
import type { PluginLogApi } from '../log/log-plugin-api.js';
import type { PluginStateApi } from '../state/node/state-plugin-api.js';
import type { PluginWsApi } from '../ws/node/ws-plugin-api.js';
import type { PluginScopeApi } from './plugin-api.js';
import type { PluginCapabilities as CapabilityMap } from './plugin-app.js';
import type { DeclaredServiceReference, SelectedServices, ServiceRegistration } from './plugin-service-types.js';
import type { PluginReadiness, PluginReadinessUpdate } from './plugin-state-types.js';

export { PluginAppService } from './plugin-app.js';

export type PluginCapabilities = CapabilityMap<PluginAppApi>;

export {
	PluginRuntime,
	type BuiltinPlugin,
	type InstalledPluginStartFailure,
	type InstalledPluginTarget,
	type PluginRuntimeApi,
} from './node/plugin-runtime-api.js';

export { buildPluginDependencyGraph } from './plugin-dependencies.js';

export { inspectPluginPackage } from './node/plugin-loader.js';

export { checkPluginEnvironment, readPluginEnvironment, type PluginEnvironment } from './node/plugin-environment.js';

/** Node 宿主为插件实例装配的能力。 */
export interface PluginAppApi {
	readonly crypto: PluginCryptoApi;
	readonly database: PluginDatabaseApi;
	readonly http: PluginHttpApi;
	readonly log: PluginLogApi;
	readonly state: PluginStateApi;
	readonly ws: PluginWsApi;
}

/** 插件通过 Node SDK 按包名和服务名扩充此接口。 */
export interface PluginServicesApi {}

interface PluginServiceScopeApi extends PluginScopeApi {
	provide(...registration: ServiceRegistration<PluginServicesApi>): () => void;
}

type PluginCleanup = () => void | Promise<void>;

/** 绑定随依赖失效而取消。回调可登记清理，恢复时宿主交付新的作用域。 */
export interface PluginDependencyScopeApi<Services = Record<string, unknown>> extends PluginServiceScopeApi {
	readonly plugin: Readonly<Services>;
}

export interface PluginReadinessApi {
	readonly value: PluginReadiness;
	set(update: PluginReadinessUpdate): void;
}

export interface PluginSelfApi {
	readonly id: string;
	readonly readiness: PluginReadinessApi;
}

/** Node 插件运行时交给 activate 的上下文。 */
export interface PluginContextApi extends PluginServiceScopeApi {
	readonly app: PluginAppApi;
	readonly self: PluginSelfApi;
	/** 由声明 nexus.authMethods 的后端插件用来登记登录方式。 */
	readonly authMethods?: AuthMethodApi;

	/** 登记依赖回调。宿主在服务可用后运行回调，activate 可先完成。 */
	use<const Selection extends Readonly<Record<string, DeclaredServiceReference<PluginServicesApi>>>>(
		services: Selection,
		setup: (
			scope: PluginDependencyScopeApi<SelectedServices<PluginServicesApi, Selection>>,
		) => void | PluginCleanup | Promise<void | PluginCleanup>,
	): () => void;
}

/** Node 插件入口的命名导出。 */
export interface PluginModuleApi {
	/** 随迁移登记的可移植数据声明。 */
	readonly backup?: BackupDeclaration;
	/** 本体在激活之前执行的 SQL 迁移定义。 */
	readonly migrations?: MigrationProvider;

	/** 资源取得后可用 context.onDispose 登记，即使本次激活失败也会清理。 */
	activate(context: PluginContextApi): void | Promise<void>;

	/** 整个插件停用时调用。只对激活成功的实例执行，此时作用域信号已取消。 */
	deactivate?(context: PluginContextApi): void | Promise<void>;
}
