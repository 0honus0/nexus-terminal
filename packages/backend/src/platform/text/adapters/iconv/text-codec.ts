import iconv from 'iconv-lite';

export function supportsEncoding(encoding: string): boolean {
	return iconv.encodingExists(encoding);
}

export function encodeText(value: string, encoding: string): Uint8Array {
	return Uint8Array.from(iconv.encode(value, encoding));
}
