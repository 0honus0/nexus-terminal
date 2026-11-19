import { z } from 'zod';
import { PluginManifestSchema } from '../plugin/plugin-manifest-types.js';
import { MarketplaceRepositorySchema, PluginDistributionSchema } from './marketplace-catalog-types.js';
import { MarketplacePluginSourceSchema, MarketplaceRepositorySourceSchema } from './marketplace-types.js';

export { MarketplaceRepositorySourceSchema, type MarketplaceRepositorySource } from './marketplace-types.js';

export type MarketplaceInstallSource = z.infer<typeof MarketplacePluginSourceSchema>;

export const MarketplaceInstallIssueSchema = z.strictObject({
	code: z.enum([
		'MARKETPLACE_PLUGIN_SOURCE_NOT_FOUND',
		'MARKETPLACE_INSTALLED_PACKAGE_UNAVAILABLE',
		'PLUGIN_ARTIFACT_UNAVAILABLE',
		'PLUGIN_ARTIFACT_AMBIGUOUS',
		'PLUGIN_SDK_INCOMPATIBLE',
		'PLUGIN_DEPENDENCY_VERSION_MISMATCH',
		'PLUGIN_DEPENDENCY_MISSING',
		'PLUGIN_DEPENDENCY_CYCLE',
		'PLUGIN_SOURCE_AMBIGUOUS',
	]),
	pluginId: z.string(),
	required: z.string().optional(),
	actual: z.string().optional(),
	repositoryIds: z.array(z.uuid()).optional(),
	path: z.array(z.string()).optional(),
});

export type MarketplaceInstallIssue = z.infer<typeof MarketplaceInstallIssueSchema>;

const MarketplaceInstallStepSchema = z.strictObject({
	package: PluginManifestSchema,
	source: MarketplacePluginSourceSchema,
	repository: MarketplaceRepositorySchema.optional(),
	distribution: PluginDistributionSchema.optional(),
	action: z.enum(['install', 'reuse', 'update']),
	previous: z
		.strictObject({
			source: MarketplacePluginSourceSchema,
			version: z.string(),
			enabled: z.boolean(),
			revision: z.string(),
		})
		.optional(),
});

export type MarketplaceInstallStep = z.infer<typeof MarketplaceInstallStepSchema>;

/** 只读确认计划。执行时须重验来源、产物和已安装基线。 */
export const MarketplaceInstallPlanSchema = z.strictObject({
	target: MarketplaceRepositorySourceSchema,
	steps: z.array(MarketplaceInstallStepSchema),
	blockers: z.array(MarketplaceInstallIssueSchema),
	affected: z.array(z.string()).optional(),
});

export type MarketplaceInstallPlan = z.infer<typeof MarketplaceInstallPlanSchema>;
