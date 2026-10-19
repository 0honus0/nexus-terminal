import type { IncomingMessage } from 'node:http';
import { HttpInputFailure } from './http-errors.js';

export interface MultipartPart {
	name: string;
	filename: string | null;
	/** Lowercase media-type essence, without parameters. */
	contentType: string | null;
	bytes: Uint8Array;
}

/** Bounded in-memory ingress. The caller owns the request deadline and disconnect signal. */
export async function readBodyBytes(request: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
	const length = request.headers['content-length'];
	if (length !== undefined && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > maxBytes)) {
		throw new HttpInputFailure(413, 'body_too_large');
	}

	const abort = () => request.destroy();

	signal.throwIfAborted();
	signal.addEventListener('abort', abort, { once: true });
	const chunks: Buffer[] = [];
	try {
		let received = 0;
		for await (const raw of request) {
			if (!Buffer.isBuffer(raw)) {
				throw new HttpInputFailure(400, 'invalid_body');
			}
			chunks.push(raw);
			signal.throwIfAborted();
			received += raw.length;
			if (received > maxBytes) {
				throw new HttpInputFailure(413, 'body_too_large');
			}
		}
		signal.throwIfAborted();
		if (length !== undefined && received !== Number(length)) {
			throw new HttpInputFailure(400, 'invalid_body');
		}
		return Buffer.concat(chunks, received);
	} finally {
		signal.removeEventListener('abort', abort);
		for (const chunk of chunks) {
			chunk.fill(0);
		}
	}
}

function invalid(): never {
	throw new HttpInputFailure(400, 'invalid_multipart');
}

/** Strict finite multipart form parser; arbitrary MIME trees and nested multipart are unsupported. */
export function decodeMultipart(bytes: Buffer, contentType: string, maxParts: number): MultipartPart[] {
	const match =
		/^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,\-./:=? ]{1,70})"|([A-Za-z0-9'()+_,\-./:=?]{1,70}))$/iu.exec(
			contentType,
		);
	const boundary = match?.[1] ?? match?.[2];
	if (!boundary || boundary.endsWith(' ')) {
		throw new HttpInputFailure(415, 'unsupported_media_type');
	}
	const delimiter = Buffer.from('--' + boundary, 'ascii');
	const separator = Buffer.from('\r\n--' + boundary, 'ascii');
	const parts: MultipartPart[] = [];
	let offset = 0;
	try {
		while (true) {
			if (!bytes.subarray(offset, offset + delimiter.length).equals(delimiter)) {
				invalid();
			}
			offset += delimiter.length;
			if (bytes.subarray(offset, offset + 2).equals(Buffer.from('--'))) {
				offset += 2;
				const tail = bytes.subarray(offset);
				if (tail.length !== 0 && !tail.equals(Buffer.from('\r\n'))) {
					invalid();
				}
				return parts;
			}
			if (!bytes.subarray(offset, offset + 2).equals(Buffer.from('\r\n')) || parts.length >= maxParts) {
				invalid();
			}
			offset += 2;
			const headerEnd = bytes.indexOf('\r\n\r\n', offset, 'ascii');
			if (headerEnd < offset || headerEnd - offset > 8192) {
				invalid();
			}
			const headers = new Map<string, string>();
			const rawHeaders = bytes.subarray(offset, headerEnd);
			if (rawHeaders.includes(0)) {
				invalid();
			}
			let decodedHeaders: string;
			try {
				decodedHeaders = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawHeaders);
			} catch {
				invalid();
			}
			for (const line of decodedHeaders.split('\r\n')) {
				const header = /^([A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);
				if (!header || !header[1] || header[2] === undefined || headers.has(header[1].toLowerCase())) {
					invalid();
				}
				const key = header[1].toLowerCase();
				if (key !== 'content-type' && key !== 'content-disposition') {
					invalid();
				}
				headers.set(key, header[2]);
			}
			const disposition =
				/^form-data;\s*name="([^"\r\n\0]{1,128})"(?:;\s*filename="([^"\r\n\0]{1,1024})")?$/iu.exec(
					headers.get('content-disposition') ?? '',
				);
			if (!disposition?.[1]) {
				invalid();
			}
			offset = headerEnd + 4;
			let end = bytes.indexOf(separator, offset);
			// A prefix inside file contents is not a delimiter unless its suffix is valid.
			while (end >= 0) {
				const suffix = bytes.subarray(end + separator.length, end + separator.length + 2);
				if (suffix.equals(Buffer.from('--')) || suffix.equals(Buffer.from('\r\n'))) {
					break;
				}
				end = bytes.indexOf(separator, end + separator.length);
			}
			if (end < 0) {
				invalid();
			}
			parts.push({
				name: disposition[1],
				filename: disposition[2] ?? null,
				contentType: headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null,
				bytes: Uint8Array.from(bytes.subarray(offset, end)),
			});
			offset = end + 2;
		}
	} catch (cause) {
		for (const part of parts) {
			part.bytes.fill(0);
		}
		throw cause;
	}
}
