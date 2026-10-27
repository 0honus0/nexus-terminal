import { AcpFailure } from '../acp-port.js';
import type { AcpPermission, AcpResult } from '../acp-port.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new AcpFailure('protocol_invalid');
	}
	return value;
}

export function text(value: unknown, maxBytes: number): string {
	if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
		throw new AcpFailure('protocol_invalid');
	}
	return value;
}

export function messageId(value: unknown): string | number {
	if (typeof value === 'number' && Number.isSafeInteger(value)) {
		return value;
	}
	return text(value, 512);
}

export function permission(
	params: Record<string, unknown>,
	requestId: string,
	sessionId: string,
): { input: AcpPermission; options: { id: string; kind: string }[] } {
	if (
		params.sessionId !== sessionId ||
		!Array.isArray(params.options) ||
		!params.options.length ||
		params.options.length > 16
	) {
		throw new AcpFailure('protocol_invalid');
	}
	const tool = record(params.toolCall);
	const inputJson = JSON.stringify(tool.rawInput ?? null);
	if (Buffer.byteLength(inputJson, 'utf8') > 32 * 1024) {
		throw new AcpFailure('limit_exceeded');
	}
	const options = params.options.map((value) => {
		const option = record(value);
		const kind = text(option.kind, 32);
		if (!['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(kind)) {
			throw new AcpFailure('protocol_invalid');
		}
		return { id: text(option.optionId, 512), kind };
	});
	if (new Set(options.map((item) => item.id)).size !== options.length) {
		throw new AcpFailure('protocol_invalid');
	}
	return {
		input: {
			sessionId,
			requestId,
			toolCallId: text(tool.toolCallId, 512),
			title: tool.title === undefined || tool.title === null ? null : text(tool.title, 256),
			kind: tool.kind === undefined || tool.kind === null ? null : text(tool.kind, 128),
			inputJson,
		},
		options,
	};
}

export function stopReason(value: unknown): AcpResult['stopReason'] {
	if (
		value !== 'end_turn' &&
		value !== 'max_tokens' &&
		value !== 'max_turn_requests' &&
		value !== 'refusal' &&
		value !== 'cancelled'
	) {
		throw new AcpFailure('protocol_invalid');
	}
	return value;
}
