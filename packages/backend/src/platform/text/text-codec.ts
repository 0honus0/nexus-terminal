export interface TextCodec {
	supportsEncoding(encoding: string): boolean;

	encodeText(value: string, encoding: string): Uint8Array;
}
