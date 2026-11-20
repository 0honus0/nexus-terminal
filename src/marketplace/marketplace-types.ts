import { z } from 'zod';
import {
	PluginDisplayNameSchema,
	PluginIconSchema,
	PluginKindSchema,
	PluginManifestSchema,
	PluginPackageNameSchema,
} from '../plugin/plugin-manifest-types.js';
import { PluginRuntimeInfoSchema } from '../plugin/plugin-state-types.js';

export const MarketplacePluginId = '@nexus-terminal/marketplace';

/** 浏览器可加载的产物；后端就绪状态由 plugin.runtime 提供。 */
export const MarketplaceFrontendSchema = z.strictObject({
	pluginId: PluginPackageNameSchema,
	version: PluginManifestSchema.shape.version,
	dependsOn: PluginManifestSchema.shape.nexus.shape.dependsOn.unwrap(),
	entryURL: z.string().startsWith('/').nullable(),
	hasBackend: z.boolean(),
});

export type MarketplaceFrontend = z.infer<typeof MarketplaceFrontendSchema>;

export const MarketplaceFrontendsSchema = z.array(MarketplaceFrontendSchema);

export const MarketplaceFrontendsTopic = { name: 'marketplace.frontends', pluginId: MarketplacePluginId } as const;

export const MarketplaceRepositorySourceSchema = z.strictObject({
	kind: z.literal('repository'),
	repositoryId: z.uuid(),
	pluginId: PluginPackageNameSchema,
	version: PluginManifestSchema.shape.version,
});

export type MarketplaceRepositorySource = z.infer<typeof MarketplaceRepositorySourceSchema>;

export const MarketplacePluginSourceSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('local') }),
	MarketplaceRepositorySourceSchema,
]);

export type MarketplacePluginSource = z.infer<typeof MarketplacePluginSourceSchema>;

export const MarketplacePluginIssueSchema = z.enum([
	'MARKETPLACE_PACKAGE_MISSING',
	'MARKETPLACE_PACKAGE_IDENTITY_MISMATCH',
	'MARKETPLACE_PACKAGE_INVALID',
	'MARKETPLACE_RUNTIME_CONFLICT',
	'MARKETPLACE_PLUGIN_START_FAILED',
	'MARKETPLACE_PLUGIN_STOP_FAILED',
	'MARKETPLACE_FRONTEND_INVALID',
	'MARKETPLACE_INSTALL_PLAN_CHANGED',
	'MARKETPLACE_PLUGIN_FETCH_FAILED',
	'MARKETPLACE_PLUGIN_REQUIRED',
	'MARKETPLACE_PLUGIN_DISABLED',
	'MARKETPLACE_PLUGIN_DATA_CLEAR_FAILED',
]);

export type MarketplacePluginIssue = z.infer<typeof MarketplacePluginIssueSchema>;

/** 启用意图持久化。运行状态和诊断来自本次宿主进程。 */
export const MarketplacePluginSchema = z.strictObject({
	pluginId: z.string().min(1),
	version: z.string().min(1),
	kind: PluginKindSchema.nullable(),
	hasBackend: z.boolean().nullable(),
	icon: PluginIconSchema.optional(),
	displayName: PluginDisplayNameSchema.optional(),
	localizedNames: z.record(z.string(), PluginDisplayNameSchema).optional(),
	source: MarketplacePluginSourceSchema,
	enabled: z.boolean(),
	runtime: PluginRuntimeInfoSchema.nullable(),
	issue: MarketplacePluginIssueSchema.nullable(),
});

export type MarketplacePlugin = z.infer<typeof MarketplacePluginSchema>;

export const MarketplaceSetEnabledChangeSchema = z.strictObject({
	action: z.literal('set-enabled'),
	pluginId: z.string().min(1).max(214),
	enabled: z.boolean(),
});

export const MarketplaceReloadChangeSchema = z.strictObject({
	action: z.literal('reload'),
	pluginId: PluginPackageNameSchema,
});

const MarketplaceInstallChangeSchema = z.strictObject({
	action: z.literal('install'),
	pluginId: PluginPackageNameSchema,
	target: MarketplaceRepositorySourceSchema,
	revision: z.hash('sha256'),
});

export const MarketplaceUninstallChangeSchema = z.strictObject({
	action: z.literal('uninstall'),
	pluginId: PluginPackageNameSchema,
	data: z.enum(['keep', 'clear']),
	revision: z.hash('sha256'),
});

export const MarketplaceClearDataChangeSchema = z.strictObject({
	action: z.literal('clear-data'),
	pluginId: PluginPackageNameSchema,
});

export const MarketplaceRetainedDataSchema = z.strictObject({
	pluginId: PluginPackageNameSchema,
	version: PluginManifestSchema.shape.version,
});

export const MarketplaceInstallAttemptSchema = z.strictObject({
	target: MarketplaceRepositorySourceSchema,
	state: z.enum(['installing', 'interrupted', 'failed']),
});

export type MarketplaceInstallAttempt = z.infer<typeof MarketplaceInstallAttemptSchema>;

export const MarketplaceOperationSchema = z.strictObject({
	id: z.uuid(),
	observationId: z.uuid().optional(),
	change: z.discriminatedUnion('action', [
		MarketplaceSetEnabledChangeSchema,
		MarketplaceReloadChangeSchema,
		MarketplaceInstallChangeSchema,
		MarketplaceUninstallChangeSchema,
		MarketplaceClearDataChangeSchema,
	]),
	state: z.enum(['queued', 'running', 'succeeded', 'failed']),
	createdAt: z.iso.datetime(),
	finishedAt: z.iso.datetime().optional(),
	committed: z.boolean(),
	completedPackages: z.array(PluginPackageNameSchema).optional(),
	step: z
		.strictObject({
			phase: z.enum(['validate', 'download', 'register', 'activate']),
			pluginId: PluginPackageNameSchema,
		})
		.optional(),
	error: MarketplacePluginIssueSchema.or(z.literal('MARKETPLACE_OPERATION_FAILED')).optional(),
});

export type MarketplaceOperation = z.infer<typeof MarketplaceOperationSchema>;

export const MarketplaceOperationsSchema = z.array(MarketplaceOperationSchema);

export const MarketplaceOperationsTopic = { name: 'marketplace.operations', pluginId: MarketplacePluginId } as const;
