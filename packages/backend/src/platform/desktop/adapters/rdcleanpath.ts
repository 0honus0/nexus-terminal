const MAX_HANDSHAKE_BYTES = 128 * 1024;

interface DerValue {
	tag: number;
	body: Buffer;
	end: number;
}

function readValue(bytes: Buffer, offset: number): DerValue {
	if (offset + 2 > bytes.length) {
		throw new Error('Invalid desktop handshake');
	}
	const tag = bytes[offset];
	let length = bytes[offset + 1];
	let start = offset + 2;
	if (length >= 128) {
		const count = length & 127;
		if (count === 0 || count > 3 || start + count > bytes.length || bytes[start] === 0) {
			throw new Error('Invalid desktop handshake');
		}
		length = 0;
		for (let index = 0; index < count; index += 1) {
			length = length * 256 + bytes[start + index];
		}
		if (length < 128) {
			throw new Error('Invalid desktop handshake');
		}
		start += count;
	}
	const end = start + length;
	if (end > bytes.length || end > MAX_HANDSHAKE_BYTES) {
		throw new Error('Invalid desktop handshake');
	}
	return { tag, body: bytes.subarray(start, end), end };
}

function unwrap(bytes: Buffer, tag: number): Buffer {
	const value = readValue(bytes, 0);
	if (value.tag !== tag || value.end !== bytes.length) {
		throw new Error('Invalid desktop handshake');
	}
	return value.body;
}

export function readCleanPathRequest(bytes: Buffer): Buffer {
	if (bytes.length > MAX_HANDSHAKE_BYTES) {
		throw new Error('Desktop handshake too large');
	}
	const sequence = unwrap(bytes, 0x30);
	let previous = -1;
	let offset = 0;
	let version = false;
	let destination = false;
	let x224: Buffer | null = null;
	while (offset < sequence.length) {
		const field = readValue(sequence, offset);
		offset = field.end;
		if (field.tag <= previous) {
			throw new Error('Invalid desktop handshake');
		}
		previous = field.tag;
		switch (field.tag) {
			case 0xa0:
				version = unwrap(field.body, 2).equals(Buffer.from([0x0d, 0x3e]));
				break;
			case 0xa2:
			case 0xa3: {
				const text = unwrap(field.body, 0x0c);
				if (text.length > 1024) {
					throw new Error('Invalid desktop handshake');
				}
				new TextDecoder('utf-8', { fatal: true }).decode(text);
				if (field.tag === 0xa2) {
					destination = text.length > 0;
				}
				break;
			}
			case 0xa6:
				x224 = unwrap(field.body, 4);
				break;
			default:
				throw new Error('Invalid desktop handshake');
		}
	}
	if (
		!version ||
		!destination ||
		!x224 ||
		x224.length < 11 ||
		x224.length > 65535 ||
		x224[0] !== 3 ||
		x224[1] !== 0 ||
		x224.readUInt16BE(2) !== x224.length ||
		x224[5] !== 0xe0
	) {
		throw new Error('Invalid desktop handshake');
	}
	return Buffer.from(x224);
}

function encodeValue(tag: number, body: Buffer): Buffer {
	const length = body.length;
	let header: number[];
	if (length < 128) {
		header = [tag, length];
	} else if (length < 256) {
		header = [tag, 0x81, length];
	} else if (length < 65536) {
		header = [tag, 0x82, length >> 8, length & 255];
	} else {
		header = [tag, 0x83, length >> 16, (length >> 8) & 255, length & 255];
	}
	return Buffer.concat([Buffer.from(header), body]);
}

export function encodeCleanPathResponse(x224: Buffer, certificates: readonly Buffer[], address: string): Buffer {
	const result = encodeValue(
		0x30,
		Buffer.concat([
			encodeValue(0xa0, encodeValue(2, Buffer.from([0x0d, 0x3e]))),
			encodeValue(0xa6, encodeValue(4, x224)),
			encodeValue(
				0xa7,
				encodeValue(0x30, Buffer.concat(certificates.map((certificate) => encodeValue(4, certificate)))),
			),
			encodeValue(0xa9, encodeValue(0x0c, Buffer.from(address, 'utf8'))),
		]),
	);
	if (result.length > MAX_HANDSHAKE_BYTES) {
		throw new Error('Desktop handshake too large');
	}
	return result;
}
