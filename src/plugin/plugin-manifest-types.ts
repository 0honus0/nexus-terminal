import valid from 'semver/functions/valid.js';
import validRange from 'semver/ranges/valid.js';
import validatePackageName from 'validate-npm-package-name';
import { z } from 'zod';

const PluginEntrySchema = z
	.strictObject({
		backend: z.string().min(1).optional(),
		frontend: z.string().min(1).optional(),
	})
	.refine(({ backend, frontend }) => backend !== undefined || frontend !== undefined, 'PLUGIN_ENTRY_REQUIRED');

const VersionRangeSchema = z
	.string()
	.trim()
	.min(1)
	.refine((range) => validRange(range) !== null);

export const PluginPackageNameSchema = z
	.string()
	.min(1)
	.max(214)
	.refine((name) => validatePackageName(name).validForNewPackages);

export const PluginKindSchema = z.enum(['application', 'extension']);

const PlatformListSchema = z.union([z.string(), z.array(z.string())]);

/** 目录、安装和加载使用同一份清单校验。运行环境及入口文件由消费者另外检查。 */
export const PluginManifestSchema = z
	.looseObject({
		name: PluginPackageNameSchema,
		version: z.string().refine((version) => valid(version) !== null),
		description: z.string().optional(),
		type: z.literal('module'),
		peerDependencies: z.object({ 'nexus-terminal': VersionRangeSchema }).catchall(z.string()),
		engines: z.looseObject({ node: VersionRangeSchema.optional() }).optional(),
		os: PlatformListSchema.optional(),
		cpu: PlatformListSchema.optional(),
		libc: PlatformListSchema.optional(),
		nexus: z.looseObject({
			kind: PluginKindSchema,
			entry: PluginEntrySchema,
			dependsOn: z.record(PluginPackageNameSchema, VersionRangeSchema).optional(),
			requiredFor: z.array(z.string().min(1)).optional(),
			mandatory: z.boolean().optional(),
			i18n: z.record(z.string(), z.object({ description: z.string() })).optional(),
			/** 后端插件是否提供登录方式。 */
			authMethods: z.boolean().optional(),
		}),
	})
	.refine(({ name, nexus }) => !Object.hasOwn(nexus.dependsOn ?? {}, name), {
		path: ['nexus', 'dependsOn'],
		message: 'PLUGIN_SELF_DEPENDENCY',
	});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
