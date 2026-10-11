import {
	WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
	WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES,
	WORKSPACE_BINARY_PROTOCOL_VERSION,
} from './values.js';

const MAGIC = 0x4e585731;
const HEADER_BYTES = 16;

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
