const TERMINAL_FRAME_MAGIC = [0x4e, 0x58, 0x54, 0x4d] as const; // NXTM
const TERMINAL_FRAME_VERSION = 1;
const TERMINAL_FRAME_MIN_HEADER_SIZE = 16;
const TERMINAL_FRAME_KNOWN_FLAGS = 1;
const MAX_TERMINAL_FRAME_PAYLOAD_BYTES = 256 * 1024;

export const enum TerminalFrameType {
  Output = 1,
  CachedOutput = 2,
}

export const enum TerminalFrameFlag {
  Final = 1 << 0,
}

export interface TerminalBinaryFrame {
  type: TerminalFrameType;
  flags: number;
  sequence: number;
  payload: Uint8Array;
}

export const parseTerminalBinaryFrame = (data: ArrayBuffer): TerminalBinaryFrame => {
  if (data.byteLength < TERMINAL_FRAME_MIN_HEADER_SIZE) {
    throw new Error(`终端二进制帧过短: ${data.byteLength}`);
  }

  const bytes = new Uint8Array(data);
  for (let index = 0; index < TERMINAL_FRAME_MAGIC.length; index += 1) {
    if (bytes[index] !== TERMINAL_FRAME_MAGIC[index]) {
      throw new Error('未知的服务端二进制消息类型');
    }
  }

  const view = new DataView(data);
  const version = view.getUint8(4);
  if (version !== TERMINAL_FRAME_VERSION) {
    throw new Error(`不支持的终端二进制协议版本: ${version}`);
  }

  const type = view.getUint8(5);
  if (type !== TerminalFrameType.Output && type !== TerminalFrameType.CachedOutput) {
    throw new Error(`未知的终端二进制帧类型: ${type}`);
  }

  const flags = view.getUint8(6);
  if ((flags & ~TERMINAL_FRAME_KNOWN_FLAGS) !== 0) {
    throw new Error(`终端二进制帧包含未知标志: ${flags}`);
  }

  const headerSize = view.getUint8(7);
  if (headerSize < TERMINAL_FRAME_MIN_HEADER_SIZE || headerSize > data.byteLength) {
    throw new Error(`终端二进制帧头长度无效: ${headerSize}`);
  }

  const payloadLength = view.getUint32(8, false);
  if (payloadLength > MAX_TERMINAL_FRAME_PAYLOAD_BYTES) {
    throw new Error(`终端二进制帧负载超过限制: ${payloadLength}/${MAX_TERMINAL_FRAME_PAYLOAD_BYTES}`);
  }
  if (headerSize + payloadLength !== data.byteLength) {
    throw new Error(`终端二进制帧长度不匹配: ${payloadLength}/${data.byteLength - headerSize}`);
  }

  return {
    type,
    flags,
    sequence: view.getUint32(12, false),
    payload: new Uint8Array(data, headerSize, payloadLength),
  };
};
