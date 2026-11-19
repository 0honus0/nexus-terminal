import { z } from 'zod';
import { BackupPluginId } from './backup-types.js';

export const backupBase = `/api/plugins/${encodeURIComponent(BackupPluginId)}`;

export const BackupPasswordSchema = z.strictObject({ password: z.string().min(1).max(1024) });

export const BackupFileSchema = z.strictObject({
	format: z.literal(1),
	payload: z
		.string()
		.min(1)
		.max(1_800_000)
		.regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});

export const BackupImportSchema = BackupPasswordSchema.extend({ file: BackupFileSchema });

export const BackupPreviewSchema = z.strictObject({
	installs: z.array(z.strictObject({ pluginId: z.string(), version: z.string(), repository: z.string() })),
	tables: z.array(z.strictObject({ pluginId: z.string(), table: z.string(), rows: z.int().nonnegative() })),
});

export const BackupRestoreIssueSchema = z.enum([
	'BACKUP_PLUGIN_VERSION_CONFLICT',
	'BACKUP_PLUGIN_SOURCE_UNAVAILABLE',
	'BACKUP_PLUGIN_ARTIFACT_UNAVAILABLE',
	'BACKUP_PLUGIN_DEPENDENCY_UNAVAILABLE',
	'BACKUP_RESTORE_PLAN_CHANGED',
	'BACKUP_RESTORE_TRIGGER_UNSAFE',
	'BACKUP_RESTORE_RELATIONSHIP_UNSAFE',
]);

export const BackupStatusSchema = z.strictObject({
	id: z.uuid(),
	state: z.enum(['restoring', 'succeeded', 'failed']),
	error: BackupRestoreIssueSchema.optional(),
});

export type BackupPreview = z.infer<typeof BackupPreviewSchema>;

export const BackupPlanSchema = BackupPreviewSchema.extend({ token: z.uuid() });

export const BackupRestoreSchema = BackupImportSchema.extend({ token: z.uuid() });

export const BackupJobSchema = z.strictObject({ job: BackupStatusSchema.nullable() });

export const BackupStatusTopic = { pluginId: BackupPluginId, name: 'backup.status' } as const;
