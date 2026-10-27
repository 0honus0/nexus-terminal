import {
	WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
	WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES,
	WORKSPACE_BINARY_PROTOCOL_VERSION,
} from './values.js';

const MAGIC = 0x4e585731;

const HEADER_BYTES = 16;

export type WorkspaceBinaryFrame =
	| { kind: 'terminal'; final: false; data: Uint8Array }
	| { kind: 'response'; requestId: string; final: boolean; data: Uint8Array };

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Validate the complete NXW1 header before exposing a borrowed payload view. */
export function decodeWorkspaceBinaryFrame(raw: Uint8Array): WorkspaceBinaryFrame {
	if (raw.byteLength < HEADER_BYTES) {
		throw new RangeError('Invalid NXW1 frame');
	}
	const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const kind = view.getUint8(5);
	const flags = view.getUint8(6);
	const idBytes = view.getUint16(8);
	const payloadBytes = view.getUint32(12);
	if (
		view.getUint32(0) !== MAGIC ||
		view.getUint8(4) !== WORKSPACE_BINARY_PROTOCOL_VERSION ||
		(flags & ~1) !== 0 ||
		view.getUint8(7) !== 0 ||
		view.getUint16(10) !== 0 ||
		payloadBytes > WORKSPACE_BINARY_MAX_PAYLOAD_BYTES ||
		raw.byteLength !== HEADER_BYTES + idBytes + payloadBytes
	) {
		throw new RangeError('Invalid NXW1 frame');
	}
	const data = raw.subarray(HEADER_BYTES + idBytes);
	if (kind === 1 && idBytes === 0 && flags === 0) {
		return { kind: 'terminal', final: false, data };
	}
	if (kind !== 2 || idBytes === 0 || idBytes > WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES) {
		throw new RangeError('Invalid NXW1 frame');
	}
	const requestId = decoder.decode(raw.subarray(HEADER_BYTES, HEADER_BYTES + idBytes));
	if (!requestId) {
		throw new RangeError('Invalid NXW1 frame');
	}
	return { kind: 'response', requestId, final: flags === 1, data };
}

/** NXW1 frames; terminal has no request ID, file/history response frames always have one. */
export function encodeWorkspaceBinaryFrame(
	kind: 'terminal' | 'response',
	requestId: string | undefined,
	payload: Uint8Array,
	final = false,
): Uint8Array {
	const id = requestId === undefined ? new Uint8Array() : new TextEncoder().encode(requestId);
	if (
		(kind === 'terminal' && (id.length !== 0 || final)) ||
		(kind === 'response' && (id.length === 0 || id.length > WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES)) ||
		payload.length > WORKSPACE_BINARY_MAX_PAYLOAD_BYTES
	) {
		throw new RangeError('Invalid NXW1 frame');
	}
	const output = new Uint8Array(HEADER_BYTES + id.length + payload.length);
	const view = new DataView(output.buffer);
	view.setUint32(0, MAGIC);
	view.setUint8(4, WORKSPACE_BINARY_PROTOCOL_VERSION);
	view.setUint8(5, kind === 'terminal' ? 1 : 2);
	view.setUint8(6, final ? 1 : 0);
	view.setUint8(7, 0);
	view.setUint16(8, id.length);
	view.setUint16(10, 0);
	view.setUint32(12, payload.length);
	output.set(id, HEADER_BYTES);
	output.set(payload, HEADER_BYTES + id.length);
	return output;
}
