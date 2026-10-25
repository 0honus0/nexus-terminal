import { fileTypeFromBuffer } from 'file-type';
import { MODEL_IMAGE_MAX_BYTES, ModelNetworkFailure } from '../model-port.js';
import type { ModelImageResult } from '../model-port.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

/** Never fetch provider-returned URLs or accept executable image formats. */
export async function decodeModelImage(raw: unknown): Promise<ModelImageResult> {
	const envelope = record(raw);
	if (!envelope || (envelope.error !== undefined && envelope.error !== null)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const data = envelope.data;
	if (!Array.isArray(data) || data.length !== 1) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const encoded = record(data[0])?.b64_json;
	if (typeof encoded !== 'string' || !encoded.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	if (encoded.length > 4 * Math.ceil(MODEL_IMAGE_MAX_BYTES / 3)) {
		throw new ModelNetworkFailure('too_large');
	}
	const content = Buffer.from(encoded, 'base64');
	if (!content.length || content.toString('base64') !== encoded) {
		throw new ModelNetworkFailure('response_invalid');
	}
	if (content.byteLength > MODEL_IMAGE_MAX_BYTES) {
		throw new ModelNetworkFailure('too_large');
	}
	const detected = await fileTypeFromBuffer(content);
	const mediaType = detected?.mime;
	if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') {
		throw new ModelNetworkFailure('response_invalid');
	}
	return { bytes: content, mediaType };
}
