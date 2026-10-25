import { ModelNetworkFailure, MODEL_TOOL_MAX_CALLS, MODEL_TOOL_MAX_ARGUMENT_BYTES } from '../model-port.js';
import type { ModelToolCall } from '../model-port.js';

interface PendingCall {
	id: string;
	name: string;
	argumentsJson: string;
	itemId: string | null;
	complete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return value;
}

/** Only assembles provider protocol facts; it does not recognize or authorize business tools. */
export class ModelToolStream {
	private readonly calls = new Map<number, PendingCall>();

	constructor(private readonly enabled: boolean) {}

	private add(index: unknown, id: unknown, name: unknown, itemId: string | null): PendingCall {
		if (
			!this.enabled ||
			typeof index !== 'number' ||
			!Number.isSafeInteger(index) ||
			index < 0 ||
			this.calls.size >= MODEL_TOOL_MAX_CALLS ||
			this.calls.has(index)
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const call = { id: text(id, 256), name: text(name, 256), argumentsJson: '', itemId, complete: false };
		if (
			[...this.calls.values()].some(
				(other) => other.id === call.id || (itemId !== null && other.itemId === itemId),
			)
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		this.calls.set(index, call);
		return call;
	}

	private append(call: PendingCall, value: unknown): void {
		if (call.complete || typeof value !== 'string') {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (
			Buffer.byteLength(call.argumentsJson, 'utf8') + Buffer.byteLength(value, 'utf8') >
			MODEL_TOOL_MAX_ARGUMENT_BYTES
		) {
			throw new ModelNetworkFailure('too_large');
		}
		call.argumentsJson += value;
	}

	chat(input: unknown): void {
		if (!Array.isArray(input) || input.length > MODEL_TOOL_MAX_CALLS) {
			throw new ModelNetworkFailure('response_invalid');
		}
		for (const raw of input) {
			const row = record(raw);
			if (
				typeof row.index !== 'number' ||
				!Number.isSafeInteger(row.index) ||
				Object.keys(row).some((key) => !['index', 'id', 'type', 'function'].includes(key))
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			const fn = row.function === undefined || row.function === null ? {} : record(row.function);
			if (Object.keys(fn).some((key) => key !== 'name' && key !== 'arguments')) {
				throw new ModelNetworkFailure('response_invalid');
			}
			let call = this.calls.get(row.index);
			if (call === undefined) {
				if (row.type !== 'function') {
					throw new ModelNetworkFailure('response_invalid');
				}
				call = this.add(row.index, row.id, fn.name, null);
			} else if (
				(row.id !== undefined && row.id !== null && row.id !== call.id) ||
				(row.type !== undefined && row.type !== null && row.type !== 'function') ||
				(fn.name !== undefined && fn.name !== null && fn.name !== call.name)
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			// Nullable continuation fields are placeholders, never a new call identity.
			if (fn.arguments !== undefined && fn.arguments !== null) {
				this.append(call, fn.arguments);
			}
		}
	}

	response(event: Record<string, unknown>): void {
		if (event.type === 'response.output_item.added') {
			const item = record(event.item);
			if (item.type !== 'function_call' || item.status !== 'in_progress' || item.arguments !== '') {
				throw new ModelNetworkFailure('response_invalid');
			}
			this.add(event.output_index, item.call_id, item.name, text(item.id, 256));
			return;
		}
		if (typeof event.output_index !== 'number') {
			throw new ModelNetworkFailure('response_invalid');
		}
		const call = this.calls.get(event.output_index);
		if (!call || event.item_id !== call.itemId) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (event.type === 'response.function_call_arguments.delta') {
			this.append(call, event.delta);
		} else if (event.type === 'response.function_call_arguments.done') {
			if (
				call.complete ||
				event.arguments !== call.argumentsJson ||
				(event.name !== undefined && event.name !== call.name)
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			call.complete = true;
		} else {
			throw new ModelNetworkFailure('response_invalid');
		}
	}

	responseSnapshot(index: number, raw: unknown): ModelToolCall {
		const item = record(raw);
		const id = text(item.call_id, 256);
		const name = text(item.name, 256);
		const argumentsJson = text(item.arguments, MODEL_TOOL_MAX_ARGUMENT_BYTES);
		if (
			!this.enabled ||
			!Number.isSafeInteger(index) ||
			index < 0 ||
			item.type !== 'function_call' ||
			item.status !== 'completed'
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		let pending = this.calls.get(index);
		if (!pending) {
			pending = this.add(index, id, name, text(item.id, 256));
			this.append(pending, argumentsJson);
			pending.complete = true;
		}
		if (
			!pending.complete ||
			pending.itemId !== item.id ||
			pending.id !== id ||
			pending.name !== name ||
			pending.argumentsJson !== argumentsJson
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		return { id, name, argumentsJson };
	}

	finish(): ModelToolCall[] {
		return [...this.calls.entries()]
			.sort(([a], [b]) => a - b)
			.map(([, call]) => {
				// JSON syntax belongs to the protocol boundary; business input decoding is separate.
				let value: unknown;
				try {
					value = JSON.parse(call.argumentsJson);
				} catch {
					throw new ModelNetworkFailure('response_invalid');
				}
				record(value);
				return { id: call.id, name: call.name, argumentsJson: JSON.stringify(value) };
			});
	}
}
