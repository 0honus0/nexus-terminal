import type { TextCodec } from '../../../../platform/text/text-codec.js';
import { RemoteFileFailure } from './file-types.js';

export class FileTextModel {
	constructor(private readonly codec: TextCodec) {}

	supportsEncoding(encoding: string): boolean {
		return this.codec.supportsEncoding(encoding);
	}

	encode(value: string, encoding: string): Uint8Array {
		try {
			return Uint8Array.from(this.codec.encodeText(value, encoding));
		} catch (cause) {
			throw new RemoteFileFailure('invalid_input', { cause });
		}
	}
}
