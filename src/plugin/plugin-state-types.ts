import { z } from 'zod';

const ConfigurationRequiredSchema = z
	.strictObject({
		code: z.literal('PLUGIN_CONFIGURATION_REQUIRED'),
		applicationId: z.string().min(1).optional(),
	})
	.readonly();

const ReadySchema = z.strictObject({ state: z.literal('ready') }).readonly();

export const PluginReadinessUpdateSchema = z.discriminatedUnion('state', [
	ReadySchema,
	z.strictObject({ state: z.literal('pending'), reason: ConfigurationRequiredSchema }).readonly(),
]);

export type PluginReadinessUpdate = z.infer<typeof PluginReadinessUpdateSchema>;

export const PluginReadinessSchema = z.discriminatedUnion('state', [
	ReadySchema,
	z.strictObject({ state: z.literal('pending'), reason: ConfigurationRequiredSchema.optional() }).readonly(),
]);

export type PluginReadiness = z.infer<typeof PluginReadinessSchema>;

export const PluginRuntimeStateSchema = z.enum(['starting', 'running', 'stopping', 'stopped', 'failed']);

export type PluginRuntimeState = z.infer<typeof PluginRuntimeStateSchema>;

const PluginRuntimeIssueSchema = z.discriminatedUnion('code', [
	z.strictObject({
		code: z.enum(['PLUGIN_DEPENDENCY_NOT_RUNNING', 'PLUGIN_DEPENDENCY_NOT_READY']),
		pluginId: z.string(),
	}),
	z.strictObject({
		code: z.literal('PLUGIN_DEPENDENCY_VERSION_MISMATCH'),
		pluginId: z.string(),
		required: z.string(),
		actual: z.string(),
	}),
	z.strictObject({
		code: z.enum([
			'PLUGIN_DEPENDENCY_CYCLE',
			'PLUGIN_DEPENDENCY_SETUP_FAILED',
			'PLUGIN_START_FAILED',
			'PLUGIN_STOP_FAILED',
		]),
		pluginId: z.string(),
	}),
]);

export type PluginRuntimeIssue = Readonly<z.infer<typeof PluginRuntimeIssueSchema>>;

export const PluginRuntimeInfoSchema = z
	.strictObject({
		pluginId: z.string(),
		version: z.string(),
		runtime: PluginRuntimeStateSchema,
		readiness: PluginReadinessSchema,
		issues: z.array(PluginRuntimeIssueSchema.readonly()).readonly(),
	})
	.readonly();

export type PluginRuntimeInfo = z.infer<typeof PluginRuntimeInfoSchema>;

export const PluginRuntimeStateTopic = { name: 'plugin.runtime' } as const;

export const PluginRuntimeListSchema = z.array(PluginRuntimeInfoSchema).readonly();
