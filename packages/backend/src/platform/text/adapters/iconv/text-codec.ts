import iconv from 'iconv-lite';
import type { TextCodec } from '../../text-codec.js';

export class IconvTextCodec implements TextCodec {
	supportsEncoding(encoding: string): boolean {
		return iconv.encodingExists(encoding);
	}

	encodeText(value: string, encoding: string): Uint8Array {
		return Uint8Array.from(iconv.encode(value, encoding));
	}
}
