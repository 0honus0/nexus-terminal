import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	encodeWorkspaceBinaryFrame,
	decodeWorkspaceBinaryFrame,
} from '@nexus-terminal/shared/remote/workspace/workspace-binary';
import { WORKSPACE_BINARY_MAX_PAYLOAD_BYTES } from '@nexus-terminal/shared/remote/workspace/values';

test('NXW1 checks every header field, Unicode identity, subarrays and payload boundary', () => {
	const body = Uint8Array.of(0, 255, 10, 13);
	const terminal = encodeWorkspaceBinaryFrame('terminal', undefined, body);
	assert.deepEqual(decodeWorkspaceBinaryFrame(terminal).data, body);
	const id = '\ufeff请求';
	const response = encodeWorkspaceBinaryFrame('response', id, body, true);
	assert.equal(decodeWorkspaceBinaryFrame(response).requestId, id, 'UTF-8 request identity retains an initial BOM');
	const container = new Uint8Array(response.length + 10);
	container.set(response, 5);
	assert.deepEqual(decodeWorkspaceBinaryFrame(container.subarray(5, 5 + response.length)).data, body);
	assert.equal(
		decodeWorkspaceBinaryFrame(
			encodeWorkspaceBinaryFrame('terminal', undefined, new Uint8Array(WORKSPACE_BINARY_MAX_PAYLOAD_BYTES)),
		).data.length,
		WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
	);
	assert.equal(
		decodeWorkspaceBinaryFrame(encodeWorkspaceBinaryFrame('response', 'x'.repeat(128), new Uint8Array(), true))
			.requestId.length,
		128,
	);
	let rejected = 0;
	for (const mutate of [
		(frame) => frame.subarray(0, 15),
		(frame) => frame.subarray(0, frame.length - 1),
		(frame) => Uint8Array.from([...frame, 0]),
		(frame) => {
			frame[0] = 0;
			return frame;
		},
		(frame) => {
			frame[4] = 2;
			return frame;
		},
		(frame) => {
			frame[5] = 3;
			return frame;
		},
		(frame) => {
			frame[6] = 2;
			return frame;
		},
		(frame) => {
			frame[7] = 1;
			return frame;
		},
		(frame) => {
			frame[10] = 1;
			return frame;
		},
		(frame) => {
			frame[16] = 255;
			return frame;
		},
		(frame) => {
			new DataView(frame.buffer).setUint16(8, 129);
			return frame;
		},
		(frame) => {
			new DataView(frame.buffer).setUint32(12, WORKSPACE_BINARY_MAX_PAYLOAD_BYTES + 1);
			return frame;
		},
	]) {
		assert.throws(() => decodeWorkspaceBinaryFrame(mutate(response.slice())));
		rejected += 1;
	}
	const finalTerminal = terminal.slice();
	finalTerminal[6] = 1;
	assert.throws(() => decodeWorkspaceBinaryFrame(finalTerminal));
});
