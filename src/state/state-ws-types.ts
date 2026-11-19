import jsonPatch, { type Operation } from 'fast-json-patch';
import { z } from 'zod';

export const StateTopicSchema = z
	.strictObject({
		name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u),
		pluginId: z.string().min(1).optional(),
	})
	.readonly();

export type StateTopic = z.infer<typeof StateTopicSchema>;

export const stateWebSocketPath = '/state/ws';

export function stateTopicKey({ name, pluginId }: StateTopic): string {
	return JSON.stringify([pluginId ?? null, name]);
}

export const StateValueSchema = z.json();

export type StateValue = z.infer<typeof StateValueSchema>;

const PatchOperationSchema = z.custom<Operation>(
	(value) =>
		typeof value === 'object' &&
		value !== null &&
		'op' in value &&
		(value.op === 'add' || value.op === 'remove' || value.op === 'replace') &&
		jsonPatch.validate([value as Operation]) === undefined,
);

export const StateMessageSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('snapshot'),
		topic: StateTopicSchema,
		instanceId: z.uuid(),
		revision: z.number().int().nonnegative(),
		state: StateValueSchema,
	}),
	z.object({
		type: z.literal('patch'),
		topic: StateTopicSchema,
		instanceId: z.uuid(),
		baseRevision: z.number().int().nonnegative(),
		revision: z.number().int().positive(),
		changes: z.array(PatchOperationSchema),
	}),
	z.object({
		type: z.literal('unavailable'),
		topic: StateTopicSchema,
		code: z.literal('STATE_TOPIC_UNAVAILABLE'),
	}),
]);

export type StateMessage = z.infer<typeof StateMessageSchema>;

export const StateCommandSchema = z.strictObject({
	type: z.enum(['subscribe', 'unsubscribe', 'resync']),
	topic: StateTopicSchema,
});

export type StateCommand = z.infer<typeof StateCommandSchema>;
