import { createHash } from 'node:crypto';
import type { ImageInspector, ImageFacts, ImageFormat } from '../image-inspector.js';

/** Scans syntax only; declarations and external entities are never evaluated. */
function declarationEnd(text: string, start: number): number {
	let quote: string | null = null;
	let subset = 0;
	for (let offset = start; offset < text.length; offset++) {
		const char = text.charAt(offset);
		if (quote !== null) {
			if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '[') {
			subset++;
		} else if (char === ']') {
			if (subset === 0) {
				return -1;
			}
			subset--;
		} else if (char === '>' && subset === 0) {
			return offset;
		}
	}
	return -1;
}

function svgSignature(text: string): boolean {
	let offset = 0;
	while (offset < text.length) {
		while (offset < text.length && /\s/u.test(text.charAt(offset))) {
			offset++;
		}
		if (text.startsWith('<!--', offset) || text.startsWith('<?', offset)) {
			const comment = text.startsWith('<!--', offset);
			const marker = comment ? '-->' : '?>';
			const end = text.indexOf(marker, offset + (comment ? 4 : 2));
			if (end < 0) {
				return false;
			}
			offset = end + marker.length;
			continue;
		}
		if (text.startsWith('<!DOCTYPE', offset)) {
			const end = declarationEnd(text, offset + 9);
			if (end < 0) {
				return false;
			}
			offset = end + 1;
			continue;
		}
		if (text.charAt(offset) !== '<') {
			return false;
		}
		let end = offset + 1;
		while (end < text.length && !/[\s/>]/u.test(text.charAt(end))) {
			end++;
		}
		const name = text.slice(offset + 1, end);
		return end < text.length && (name === 'svg' || /^[A-Za-z_][\w.-]*:svg$/u.test(name));
	}
	return false;
}

/** Format evidence only; image admission belongs to the application. */
function imageFormat(bytes: Uint8Array): ImageFormat | null {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
		return 'png';
	}
	if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) {
		return 'jpeg';
	}
	if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) {
		return 'gif';
	}
	if (
		b.length >= 12 &&
		b.subarray(0, 4).toString('ascii') === 'RIFF' &&
		b.subarray(8, 12).toString('ascii') === 'WEBP'
	) {
		return 'webp';
	}
	try {
		return svgSignature(new TextDecoder('utf-8', { fatal: true }).decode(b)) ? 'svg' : null;
	} catch {
		return null;
	}
}

export class NativeImageInspector implements ImageInspector {
	inspect(bytes: Uint8Array): ImageFacts {
		if (bytes.byteLength > 64 * 1024 * 1024) {
			throw new RangeError('Image inspection technical ceiling');
		}
		return {
			format: imageFormat(bytes),
			sizeBytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
	}
}
