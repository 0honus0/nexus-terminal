export {
	LogLevelSchema,
	LogParamsSchema,
	PluginLogInputSchema,
	type LogLevel,
	type LogParams,
	type PluginLogApi,
	type PluginLogInput,
} from '../../log/log-plugin-api.js';

export type { PluginScopeApi } from '../../plugin/plugin-api.js';

export type { BackupDeclaration, BackupTable } from '../../backup/backup-types.js';

export type { PluginServiceReference, PluginServiceSelection } from '../../plugin/plugin-service-types.js';

export type { PluginReadiness, PluginReadinessUpdate } from '../../plugin/plugin-state-types.js';

export type {
	PluginAppApi,
	PluginContextApi,
	PluginDependencyScopeApi,
	PluginModuleApi,
	PluginReadinessApi,
	PluginSelfApi,
	PluginServicesApi,
} from '../../plugin/plugin-api.node.js';

export {
	CryptoOptionsSchema,
	PluginCryptoErrorCodeSchema,
	PluginCryptoFailureSchema,
	type CryptoOptions,
	type PluginCryptoApi,
	type PluginCryptoErrorCode,
	type PluginCryptoFailure,
} from '../../crypto/node/crypto-plugin-api.js';

export type { PluginDatabaseApi } from '../../database/node/database-plugin-api.js';

export type {
	AuthMethodApi,
	AuthMethodContextApi,
	AuthMethodRegistrationApi,
	AuthMethodRoute,
} from '../../auth/node/auth-method-api.js';

// 同一来源的值与类型用一条 export 声明，类型使用行内 type。
export {
	HttpFailure,
	type HttpRoute,
	type HttpStreamContext,
	type HttpStreamResponse,
	type HttpStreamRoute,
	type PluginHttpApi,
} from '../../http/node/http-plugin-api.js';

export type { PluginWsApi, WsConnectionContext, WsRoute } from '../../ws/node/ws-plugin-api.js';

export type { PluginStateApi, StatePublisherApi, StateRegistration } from '../../state/node/state-plugin-api.js';
