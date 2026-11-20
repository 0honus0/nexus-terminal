import type { PluginWindowLauncherApi } from '../window/browser/window-plugin-api.js';
import type { PluginHttpClientApi } from '../http/browser/http-plugin-client-api.js';
import type { PluginStateClientApi } from '../state/browser/state-plugin-client-api.js';
import type { PluginTasksApi } from '../task/browser/task-plugin-api.js';
import type { PluginWsClientApi } from '../ws/browser/ws-plugin-client-api.js';
import type { PluginBrowserLogApi } from '../log/browser/log-api.js';
import type { PluginContributions } from './browser/plugin-contribution-api.js';
import type { PluginScopeApi } from './plugin-api.js';
import type { PluginCapabilities as CapabilityMap } from './plugin-app.js';
import type { DeclaredServiceReference, SelectedServices, ServiceRegistration } from './plugin-service-types.js';
import type { PluginReadiness, PluginReadinessUpdate, PluginRuntimeInfo } from './plugin-state-types.js';

export { PluginAppService } from './plugin-app.js';

export { PluginScope } from './plugin-api.js';

export { resolveApplicationLabel } from './browser/plugin-contribution-api.js';

export { resolvePluginIcon } from './browser/plugin-icons.js';

export { PluginRuntime, type BrowserPluginTarget } from './browser/plugin-runtime-api.js';

export type {
	PluginComponentEntry,
	PluginContributionList,
	PluginLoginEntry,
	PluginThemeEntry,
} from './browser/plugin-contributions.js';

export type PluginCapabilities = CapabilityMap<PluginAppApi>;

/** 浏览器宿主为插件实例装配的能力。 */
export interface PluginAppApi {
	readonly http: PluginHttpClientApi;
	readonly log: PluginBrowserLogApi;
	readonly state: PluginStateClientApi;
	readonly tasks: PluginTasksApi;
	readonly ws: PluginWsClientApi;
	readonly windows: PluginWindowLauncherApi;
}

/** 插件通过 Browser SDK 按包名和服务名扩充此接口。 */
export interface PluginServicesApi {}

export type PluginBackendState = Pick<PluginRuntimeInfo, 'runtime' | 'readiness'>;

export interface PluginSelfApi {
	readonly id: string;
	readonly backend: PluginBackendState | null;
	readonly readiness: {
		readonly value: PluginReadiness;
		set(update: PluginReadinessUpdate): void;
	};
}

interface PluginServiceScopeApi extends PluginScopeApi {
	provide(...registration: ServiceRegistration<PluginServicesApi>): () => void;
}

export interface PluginDependencyScopeApi<Services = Record<string, unknown>> extends PluginServiceScopeApi {
	readonly plugin: Readonly<Services>;
}

type Cleanup = Parameters<PluginScopeApi['onDispose']>[0];

/** 浏览器插件运行时交给 activate 的上下文。 */
export interface PluginContextApi extends PluginServiceScopeApi {
	readonly app: PluginAppApi;
	readonly self: PluginSelfApi;

	/** 激活期间声明贡献。入口执行成功后由宿主发布，停用时自动撤销。 */
	contribute(contributions: PluginContributions): void;

	use<const Selection extends Readonly<Record<string, DeclaredServiceReference<PluginServicesApi>>>>(
		services: Selection,
		setup: (
			scope: PluginDependencyScopeApi<SelectedServices<PluginServicesApi, Selection>>,
		) => void | Cleanup | Promise<void | Cleanup>,
	): () => void;
}

/** 浏览器插件入口。每次启用注入新作用域并重新执行 activate。 */
export interface PluginModuleApi {
	activate(context: PluginContextApi): void | Promise<void>;

	/** 仅对成功激活的实例执行。调用时对应的信号已取消。 */
	deactivate?(context: PluginContextApi): void | Promise<void>;
}
