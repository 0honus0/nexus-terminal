import { z } from 'zod';
import { PluginKindSchema, PluginManifestSchema, PluginPackageNameSchema } from '../plugin/plugin-manifest-types.js';

export const MarketplaceRepositoryUrlSchema = z.url({ protocol: /^https?$/u }).refine((value) => {
	const url = URL.parse(value);
	return url !== null && !url.username && !url.password && !url.hash;
});

export const MarketplaceRepositorySchema = z.strictObject({
	id: z.uuid(),
	url: MarketplaceRepositoryUrlSchema,
	label: z.string().min(1),
	official: z.boolean(),
});

export type MarketplaceRepository = z.infer<typeof MarketplaceRepositorySchema>;

export const PluginArtifactPlatformSchema = z.strictObject({
	os: z.string().min(1),
	arch: z.string().min(1),
	libc: z.enum(['glibc', 'musl']).optional(),
	node: z.string().min(1).optional(),
	abi: z.string().regex(/^\d+$/u).optional(),
});

export const PluginDistributionSchema = z.strictObject({
	tarball: MarketplaceRepositoryUrlSchema,
	integrity: z.string().min(1).optional(),
	platform: PluginArtifactPlatformSchema.optional(),
});

export type PluginDistribution = z.infer<typeof PluginDistributionSchema>;

const RepositoryCatalogVersionSchema = z.object({
	package: PluginManifestSchema,
	distributions: z.array(PluginDistributionSchema).default([]),
});

/** 远程目录不参与分配 repositoryId，归属由宿主写入缓存及响应。 */
export const RepositoryCatalogSchema = z.array(
	z.object({
		id: PluginPackageNameSchema,
		versions: z.array(RepositoryCatalogVersionSchema),
	}),
);

export type RepositoryCatalog = z.infer<typeof RepositoryCatalogSchema>;

const MarketplaceCatalogVersionSchema = RepositoryCatalogVersionSchema.extend({ repositoryId: z.uuid() });

export const MarketplaceCatalogPluginSchema = z.object({
	id: z.string(),
	versions: z.array(MarketplaceCatalogVersionSchema),
});

export type MarketplaceCatalogPlugin = z.infer<typeof MarketplaceCatalogPluginSchema>;

export const MarketplaceCatalogQuerySchema = z.strictObject({
	keyword: z.string().optional(),
	kind: PluginKindSchema.optional(),
	release: z.enum(['stable', 'prerelease', 'all']).optional(),
});

export type MarketplaceCatalogQuery = z.infer<typeof MarketplaceCatalogQuerySchema>;
