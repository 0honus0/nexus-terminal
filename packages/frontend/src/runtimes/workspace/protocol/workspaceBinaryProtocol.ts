const FRAME_MAGIC = 0x4e585731; // NXW1
const FRAME_HEADER_BYTES = 16;
const FRAME_TERMINAL = 1;
const FRAME_RESPONSE = 2;
const FLAG_FINAL = 1;
const MAX_REQUEST_ID_BYTES = 128;
export const WORKSPACE_BINARY_PROTOCOL_VERSION = 1 as const;
export const MAX_WORKSPACE_BINARY_PAYLOAD_BYTES = 256 * 1024;

export type WorkspaceBinaryFrame =
  | { kind: 'terminal'; final: boolean; data: Uint8Array }
  | { kind: 'response'; requestId: string; final: boolean; data: Uint8Array };

const decoder = new TextDecoder('utf-8', { fatal: true });

export const decodeWorkspaceBinaryFrame = (raw: Uint8Array): WorkspaceBinaryFrame => {
  if (raw.byteLength < FRAME_HEADER_BYTES) throw new Error('Workspace binary frame is truncated.');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (
    view.getUint32(0) !== FRAME_MAGIC ||
    view.getUint8(4) !== WORKSPACE_BINARY_PROTOCOL_VERSION ||
    view.getUint8(7) !== 0 ||
    view.getUint16(10) !== 0
  ) {
    throw new Error('Workspace binary protocol mismatch.');
  }
  const type = view.getUint8(5);
  const flags = view.getUint8(6);
  if ((flags & ~FLAG_FINAL) !== 0) throw new Error('Workspace binary frame flags are invalid.');
  const requestIdBytes = view.getUint16(8);
  const payloadBytes = view.getUint32(12);
  if (payloadBytes > MAX_WORKSPACE_BINARY_PAYLOAD_BYTES) throw new Error('Workspace binary frame is too large.');
  if (raw.byteLength !== FRAME_HEADER_BYTES + requestIdBytes + payloadBytes) {
    throw new Error('Workspace binary frame length is invalid.');
  }
  const final = (flags & FLAG_FINAL) !== 0;
  const idBytes = raw.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + requestIdBytes);
  const data = raw.subarray(FRAME_HEADER_BYTES + requestIdBytes);
  if (type === FRAME_TERMINAL) {
    if (requestIdBytes !== 0 || final) throw new Error('Workspace terminal frame is invalid.');
    return { kind: 'terminal', final: false, data };
  }
  if (type !== FRAME_RESPONSE || requestIdBytes === 0 || requestIdBytes > MAX_REQUEST_ID_BYTES) {
    throw new Error('Workspace binary frame type is invalid.');
  }
  const requestId = decoder.decode(idBytes);
  if (!requestId) throw new Error('Workspace binary response requestId is invalid.');
  return { kind: 'response', requestId, final, data };
};
