import * as z from 'zod/mini';
import { InvalidAgentPayload } from '../http-codec.js';

/** Fixed connection destinations are Host facts, separate from a plugin's business configuration. */
export const agentPluginConnectorSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('none') }),
	z.strictObject({ kind: z.literal('http'), endpoint: z.url(), privateAuthorities: z.array(z.string()) }),
	z.strictObject({
		kind: z.literal('remoteProcess'),
		connectionId: z.int().check(z.gte(1)),
		argv: z.array(z.string()).check(z.minLength(1)),
		cwd: z.string(),
	}),
]);

export type AgentPluginConnector = z.infer<typeof agentPluginConnectorSchema>;

export interface AgentPluginConnectionView {
	instanceId: string;
	revision: number;
	connector: AgentPluginConnector;
	hasCredential: boolean;
}

export interface AgentPluginConnectionWrite {
	expectedRevision: number;
	connector: AgentPluginConnector;
	credential: { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
}

export function readAgentPluginConnector(input: unknown): AgentPluginConnector {
	const result = z.safeParse(agentPluginConnectorSchema, input);
	if (!result.success) {
		throw new InvalidAgentPayload();
	}
	const value = result.data;
	if (value.kind === 'http') {
		const url = new URL(value.endpoint);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			new Set(value.privateAuthorities).size !== value.privateAuthorities.length
		) {
			throw new InvalidAgentPayload();
		}
		return {
			kind: value.kind,
			endpoint: value.endpoint,
			privateAuthorities: value.privateAuthorities.map((authority) => authority),
		};
	}
	if (value.kind === 'remoteProcess') {
		if (
			value.argv.some((arg) => arg.includes('\0')) ||
			!value.argv[0] ||
			!value.cwd.startsWith('/') ||
			value.cwd.includes('\0')
		) {
			throw new InvalidAgentPayload();
		}
		return {
			kind: value.kind,
			connectionId: value.connectionId,
			argv: value.argv.map((arg) => arg),
			cwd: value.cwd,
		};
	}
	return { kind: 'none' };
}
