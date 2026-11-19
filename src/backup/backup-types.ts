import { z } from 'zod';
import { PluginManifestSchema } from '../plugin/plugin-manifest-types.js';

const IdentifierSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-z_][a-z0-9_]*$/u);

const BackupFieldSchema = z.union([
	z.literal('plain'),
	z.literal('secret'),
	z.strictObject({ secret: z.string().min(1).max(256) }),
]);

/** 逻辑表名由宿主绑定插件身份。keys 应与表的主键顺序一致。 */
export const BackupTableSchema = z
	.strictObject({
		table: IdentifierSchema,
		version: z.int().positive(),
		keys: z.array(IdentifierSchema).min(1).max(32),
		fields: z.record(IdentifierSchema, BackupFieldSchema),
	})
	.superRefine(({ table, keys, fields }, ctx) => {
		if (
			table === 'migrations' ||
			table === 'migration_lock' ||
			new Set(keys).size !== keys.length ||
			keys.some((key) => fields[key] !== 'plain')
		)
			ctx.addIssue({ code: 'custom', message: 'BACKUP_DECLARATION_INVALID' });
	});

export const BackupDeclarationSchema = z
	.array(BackupTableSchema)
	.max(100)
	.refine((tables) => new Set(tables.map(({ table }) => table)).size === tables.length);

export type BackupTable = z.infer<typeof BackupTableSchema>;

export type BackupDeclaration = readonly BackupTable[];

export const BackupPluginId = '@nexus-terminal/backup';

export const BackupPackageSchema = z.strictObject({
	pluginId: PluginManifestSchema.shape.name,
	pluginVersion: PluginManifestSchema.shape.version,
	repositoryUrl: z.url({ protocol: /^https?$/u }).optional(),
	dependsOn: PluginManifestSchema.shape.nexus.shape.dependsOn.unwrap(),
	enabled: z.boolean(),
});

export type BackupPackage = z.infer<typeof BackupPackageSchema>;
