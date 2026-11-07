import * as z from 'zod/mini';
import { encodeAgentJson, InvalidAgentPayload } from '../http-codec.js';
import { isWellFormedFileText } from '../../remote/files/text-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import type { AgentPluginServiceTransportRequest, AgentPluginServiceTransportResult } from './service-transport.js';
import type { AgentPluginTransportSession } from './service-transport.js';
import { readAgentId } from '../http-codec.js';

function text(allowEmpty = false) {
	return z
		.string()
		.check(
			z.refine(
				(value) => (allowEmpty || value.length > 0) && !value.includes('\0') && isWellFormedFileText(value),
			),
		);
}

function integer(minimum = 0) {
	return z.int().check(z.gte(minimum), z.lte(Number.MAX_SAFE_INTEGER));
}

const opaque = text();

const session = z.strictObject({
	sessionId: text(),
	transport: z.discriminatedUnion('kind', [
		z.strictObject({ kind: z.literal('none') }),
		z.strictObject({ kind: z.literal('http'), grant: text() }),
		z.strictObject({ kind: z.literal('remoteProcess'), grant: text(), cwd: text() }),
	]),
});

export function readAgentPluginTransportSession(input: unknown): AgentPluginTransportSession {
	const result = z.safeParse(session, input);
	if (!result.success) {
		throw new InvalidAgentPayload();
	}
	const value = result.data;
	return {
		sessionId: readAgentId(value.sessionId),
		transport:
			value.transport.kind === 'none'
				? { kind: 'none' }
				: value.transport.kind === 'http'
					? { kind: 'http', grant: value.transport.grant }
					: { kind: 'remoteProcess', grant: value.transport.grant, cwd: value.transport.cwd },
	};
}

const base64 = z.string().check(
	z.refine((value) => {
		try {
			return btoa(atob(value)) === value;
		} catch {
			return false;
		}
	}),
);

const header = z.strictObject({
	name: text().check(z.regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu)),
	value: text(true).check(z.regex(/^[\t\x20-\x7e\x80-\xff]*$/u)),
});

const json = text().check(
	z.refine((value) => {
		try {
			JSON.parse(value);
			return true;
		} catch {
			return false;
		}
	}),
);

const request = z.discriminatedUnion('method', [
	z.strictObject({ method: z.literal('transport.http.open'), params: z.strictObject({ grant: opaque }) }),
	z.strictObject({
		method: z.literal('transport.http.request'),
		params: z
			.strictObject({
				leaseId: opaque,
				method: z.enum(['GET', 'POST', 'DELETE']),
				headers: z.array(header),
				bodyUtf8: z.nullable(text(true)),
			})
			.check(z.refine((value) => value.method !== 'GET' || value.bodyUtf8 === null)),
	}),
	z.strictObject({ method: z.literal('transport.http.read'), params: z.strictObject({ requestId: opaque }) }),
	z.strictObject({ method: z.literal('transport.http.cancel'), params: z.strictObject({ requestId: opaque }) }),
	z.strictObject({ method: z.literal('transport.http.close'), params: z.strictObject({ leaseId: opaque }) }),
	z.strictObject({ method: z.literal('transport.stdio.open'), params: z.strictObject({ grant: opaque }) }),
	z.strictObject({
		method: z.literal('transport.stdio.read'),
		params: z.strictObject({ channelId: opaque, stream: z.enum(['stdout', 'stderr']) }),
	}),
	z.strictObject({
		method: z.literal('transport.stdio.write'),
		params: z.strictObject({ channelId: opaque, bytesBase64: base64, permissionGrant: z.nullable(opaque) }),
	}),
	z.strictObject({ method: z.literal('transport.stdio.end'), params: z.strictObject({ channelId: opaque }) }),
	z.strictObject({ method: z.literal('transport.stdio.cancel'), params: z.strictObject({ channelId: opaque }) }),
	z.strictObject({ method: z.literal('transport.stdio.close'), params: z.strictObject({ channelId: opaque }) }),
	z.strictObject({ method: z.literal('transport.stdio.outcome'), params: z.strictObject({ channelId: opaque }) }),
	z.strictObject({
		method: z.literal('transport.permission.request'),
		params: z.strictObject({
			channelId: opaque,
			sessionId: text(),
			toolCallId: text(),
			requestId: text(),
			title: text(true),
			kind: z.nullable(text()),
			inputJson: json,
		}),
	}),
]);

const processOutcome = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('completed'), exitCode: z.literal(0) }),
	z.strictObject({ kind: z.literal('nonzero'), exitCode: integer(1) }),
	z
		.strictObject({
			kind: z.literal('unknown'),
			reason: z.enum(['disconnect', 'timeout', 'cancelled', 'channel_error', 'remote_signal']),
			signal: z.nullable(text()),
		})
		.check(z.refine((value) => (value.reason === 'remote_signal' ? value.signal !== null : value.signal === null))),
]);

const result = z.discriminatedUnion('method', [
	z.strictObject({ method: z.literal('transport.http.open'), value: z.strictObject({ leaseId: opaque }) }),
	z.strictObject({
		method: z.literal('transport.http.request'),
		value: z.strictObject({
			requestId: opaque,
			status: integer(100).check(z.lte(599)),
			statusText: text(true),
			headers: z.array(header),
			hasBody: z.boolean(),
		}),
	}),
	z.strictObject({
		method: z.enum(['transport.http.read', 'transport.stdio.read']),
		value: z.strictObject({ bytesBase64: base64, eof: z.boolean() }),
	}),
	z.strictObject({ method: z.literal('transport.stdio.open'), value: z.strictObject({ channelId: opaque }) }),
	z.strictObject({ method: z.literal('transport.stdio.outcome'), value: processOutcome }),
	z.strictObject({
		method: z.literal('transport.permission.request'),
		value: z.strictObject({ decision: z.enum(['allow_once', 'reject_once']), grant: opaque }),
	}),
	z.strictObject({
		method: z.enum([
			'transport.http.cancel',
			'transport.http.close',
			'transport.stdio.write',
			'transport.stdio.end',
			'transport.stdio.cancel',
			'transport.stdio.close',
		]),
		value: z.null(),
	}),
]);

export function readAgentPluginServiceTransportRequest(input: unknown): AgentPluginServiceTransportRequest {
	try {
		encodeAgentJson(input, AGENT_PLUGIN_MAX_MESSAGE_BYTES);
		return request.parse(input);
	} catch {
		throw new InvalidAgentPayload();
	}
}

export function readAgentPluginServiceTransportResult(
	input: unknown,
	expected: AgentPluginServiceTransportRequest,
): AgentPluginServiceTransportResult {
	try {
		encodeAgentJson(input, AGENT_PLUGIN_MAX_MESSAGE_BYTES);
		const decoded = result.parse(input);
		if (decoded.method !== expected.method) {
			throw new InvalidAgentPayload();
		}
		return decoded;
	} catch {
		throw new InvalidAgentPayload();
	}
}
