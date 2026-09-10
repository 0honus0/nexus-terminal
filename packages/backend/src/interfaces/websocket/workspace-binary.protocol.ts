import { Buffer } from 'node:buffer';

const FRAME_MAGIC = 0x4e585731; // NXW1
const FRAME_HEADER_BYTES = 16;
const FRAME_TERMINAL = 1;
const FRAME_RESPONSE = 2;
const FLAG_FINAL = 1;
export const MAX_WORKSPACE_BINARY_REQUEST_ID_BYTES = 128;
export const WORKSPACE_BINARY_PROTOCOL_VERSION = 1 as const;
export const MAX_WORKSPACE_BINARY_PAYLOAD_BYTES = 256 * 1024;

export type WorkspaceBinaryFrameKind = 'terminal' | 'response';

export const encodeWorkspaceBinaryFrame = (
  kind: WorkspaceBinaryFrameKind,
  requestId: string | undefined,
  payload: Uint8Array,
  final = false,
): Buffer => {
  const type = kind === 'terminal' ? FRAME_TERMINAL : FRAME_RESPONSE;
  const id = requestId ? Buffer.from(requestId, 'utf8') : Buffer.alloc(0);
  if (kind === 'terminal' && id.byteLength !== 0) throw new Error('WORKSPACE_BINARY_PROTOCOL_INVALID');
  if (kind === 'response' && (id.byteLength === 0 || id.byteLength > MAX_WORKSPACE_BINARY_REQUEST_ID_BYTES)) {
    throw new Error('WORKSPACE_BINARY_PROTOCOL_INVALID');
  }
  if (payload.byteLength > MAX_WORKSPACE_BINARY_PAYLOAD_BYTES) throw new Error('WORKSPACE_BINARY_FRAME_TOO_LARGE');

  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + id.byteLength + payload.byteLength);
  frame.writeUInt32BE(FRAME_MAGIC, 0);
  frame.writeUInt8(WORKSPACE_BINARY_PROTOCOL_VERSION, 4);
  frame.writeUInt8(type, 5);
  frame.writeUInt8(final ? FLAG_FINAL : 0, 6);
  frame.writeUInt8(0, 7);
  frame.writeUInt16BE(id.byteLength, 8);
  frame.writeUInt16BE(0, 10);
  frame.writeUInt32BE(payload.byteLength, 12);
  id.copy(frame, FRAME_HEADER_BYTES);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, FRAME_HEADER_BYTES + id.byteLength);
  return frame;
};
