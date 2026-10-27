import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { XMLParser } from 'fast-xml-parser';
import type { ImageInspector, ImageFacts, ImageFormat } from '../image-inspector.js';

const RASTER_FORMATS: ReadonlyMap<string, ImageFormat> = new Map([
	['jpg', 'jpeg'],
	['png', 'png'],
	['gif', 'gif'],
	['webp', 'webp'],
]);

function hasSvgRoot(bytes: Uint8Array): boolean {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		// Stop at the root's contents: classification does not build a tree for every SVG node.
		const parser = new XMLParser({
			preserveOrder: true,
			ignoreAttributes: true,
			ignoreDeclaration: true,
			ignorePiTags: true,
			processEntities: false,
			stopNodes: ['*'],
		});
		const parsed: unknown = parser.parse(text);
		if (!Array.isArray(parsed) || parsed.length !== 1) {
			return false;
		}
		const root: unknown = parsed[0];
		if (root === null || typeof root !== 'object') {
			return false;
		}
		const names = Object.keys(root);
		return names.length === 1 && names.some((name) => name === 'svg' || /^[A-Za-z_][\w.-]*:svg$/u.test(name));
	} catch {
		// Unrecognized or malformed XML provides no image-format evidence.
		return false;
	}
}

/** Format evidence only; neither MIME detection nor XML parsing sanitizes an image. */
export class NativeImageInspector implements ImageInspector {
	async inspect(bytes: Uint8Array): Promise<ImageFacts> {
		if (bytes.byteLength > 64 * 1024 * 1024) {
			throw new RangeError('Image inspection technical ceiling');
		}
		const detected = await fileTypeFromBuffer(bytes);
		let format = detected ? (RASTER_FORMATS.get(detected.ext) ?? null) : null;
		if (!detected && hasSvgRoot(bytes)) {
			format = 'svg';
		}
		return { format, sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
	}
}
