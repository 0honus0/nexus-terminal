import { supportsEncoding, encodeText } from '../../../../platform/text/adapters/iconv/text-codec.js';
import { RemoteFileFailure } from './file-types.js';

export function supportsFileEncoding(encoding: string): boolean {
	return supportsEncoding(encoding);
}

export function encodeFileText(value: string, encoding: string): Uint8Array {
	try {
		return Uint8Array.from(encodeText(value, encoding));
	} catch (cause) {
		throw new RemoteFileFailure('invalid_input', { cause });
	}
}
