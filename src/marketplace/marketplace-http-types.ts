import { z } from 'zod';
import { PluginRuntimeInfoSchema } from '../plugin/plugin-state-types.js';
import {
	MarketplaceCatalogPluginSchema,
	MarketplaceRepositorySchema,
	MarketplaceRepositoryUrlSchema,
} from './marketplace-catalog-types.js';
import { MarketplaceInstallPlanSchema, MarketplaceRepositorySourceSchema } from './marketplace-install-types.js';
import {
	MarketplaceClearDataChangeSchema,
	MarketplaceInstallAttemptSchema,
	MarketplaceOperationsSchema,
	MarketplaceRetainedDataSchema,
	MarketplaceReloadChangeSchema,
	MarketplaceUninstallChangeSchema,
	MarketplaceFrontendSchema,
	MarketplacePluginSchema,
	MarketplaceSetEnabledChangeSchema,
} from './marketplace-types.js';

export const marketplaceFrontendPath = '/marketplace/frontends';

export const marketplaceFrontendBase = `/api${marketplaceFrontendPath}`;

export const marketplacePreloginPath = `${marketplaceFrontendPath}/prelogin`;

const MarketplacePreloginEntrySchema = MarketplaceFrontendSchema.extend({
	backend: PluginRuntimeInfoSchema.unwrap().pick({ runtime: true, readiness: true }).nullable(),
});

export const MarketplacePreloginSchema = z.strictObject({ items: z.array(MarketplacePreloginEntrySchema) });

export type MarketplacePrelogin = z.infer<typeof MarketplacePreloginSchema>;

const AssetSegmentSchema = z
	.string()
	.min(1)
	.max(255)
	.refine((value) => !value.startsWith('.') && !/[\\/\p{Cc}]/u.test(value));

export const MarketplaceFrontendAssetParamsSchema = MarketplaceFrontendSchema.pick({ pluginId: true }).extend({
	revision: z.string().regex(/^[a-f0-9]{64}$/u),
	asset: z.array(AssetSegmentSchema).min(1),
});

export const MarketplacePluginListSchema = z.strictObject({ items: z.array(MarketplacePluginSchema) });

export const MarketplacePluginParamsSchema = MarketplaceSetEnabledChangeSchema.pick({ pluginId: true });

export const MarketplaceSetEnabledSchema = MarketplaceSetEnabledChangeSchema.omit({ action: true }).extend({
	observationId: z.uuid().optional(),
});

export const MarketplaceOperationParamsSchema = z.strictObject({ operationId: z.uuid() });

export const MarketplaceOperationListSchema = z.strictObject({ items: MarketplaceOperationsSchema });

export const MarketplaceRepositoryListSchema = z.strictObject({ items: z.array(MarketplaceRepositorySchema) });

export const MarketplaceAddRepositorySchema = z.strictObject({ url: MarketplaceRepositoryUrlSchema });

export const MarketplaceRepositoryParamsSchema = z.strictObject({ repositoryId: z.uuid() });

export const MarketplaceUpdateRepositorySchema = MarketplaceRepositoryParamsSchema.extend({
	url: MarketplaceRepositoryUrlSchema,
	label: z.string().trim().min(1),
});

export const MarketplaceCatalogListSchema = z.strictObject({ items: z.array(MarketplaceCatalogPluginSchema) });

export const MarketplacePlanInstallSchema = MarketplaceRepositorySourceSchema;

export const MarketplaceConfirmInstallSchema = z.strictObject({
	plan: MarketplaceInstallPlanSchema,
	observationId: z.uuid().optional(),
});

export const MarketplaceUninstallPlanSchema = z.strictObject({
	pluginId: MarketplacePluginParamsSchema.shape.pluginId,
	version: z.string(),
	revision: MarketplaceUninstallChangeSchema.shape.revision,
	dependents: z.array(z.string()),
	required: z.boolean(),
});

export const MarketplaceUninstallSchema = MarketplaceUninstallChangeSchema.omit({ action: true }).extend({
	observationId: z.uuid().optional(),
});

export const MarketplaceClearDataSchema = MarketplaceClearDataChangeSchema.omit({ action: true }).extend({
	observationId: z.uuid().optional(),
});

export const MarketplaceRetainedDataListSchema = z.strictObject({ items: z.array(MarketplaceRetainedDataSchema) });

export const MarketplaceInstallAttemptsSchema = z.strictObject({ items: z.array(MarketplaceInstallAttemptSchema) });

export const MarketplaceReloadSchema = MarketplaceReloadChangeSchema.omit({ action: true }).extend({
	observationId: z.uuid().optional(),
});
