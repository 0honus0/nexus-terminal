import formidable, { multipart } from 'formidable';
import { Readable } from 'node:stream';
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

/** Formidable consumes bounded in-memory input; overriding every part prevents temporary files. */
export async function decodeMultipart(
	bytes: Buffer,
	contentType: string,
	maxParts: number,
	signal: AbortSignal,
): Promise<MultipartPart[]> {
	const source = Object.assign(Readable.from([bytes]), {
		headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
	});
	const form = formidable({ enabledPlugins: [multipart] });
	const parts: MultipartPart[] = [];
	const owned: Buffer[] = [];
	let failure: HttpInputFailure | null = null;
	form.onPart = (part) => {
		const name = part.name;
		const filename = part.originalFilename;
		if (
			!name ||
			name.length > 128 ||
			/[\r\n\0]/u.test(name) ||
			(filename !== null && (filename.length > 1024 || /[\r\n\0]/u.test(filename)))
		) {
			failure ??= new HttpInputFailure(400, 'invalid_multipart');
		}
		if (parts.length >= maxParts) {
			failure ??= new HttpInputFailure(400, 'invalid_multipart');
			return;
		}
		const result: MultipartPart = {
			name: name ?? '',
			filename,
			contentType: part.mimetype?.split(';', 1)[0]?.trim().toLowerCase() ?? null,
			bytes: new Uint8Array(),
		};
		const chunks: Buffer[] = [];
		parts.push(result);
		part.on('data', (chunk: unknown) => {
			if (!Buffer.isBuffer(chunk)) {
				failure ??= new HttpInputFailure(400, 'invalid_multipart');
				return;
			}
			const copy = Buffer.from(chunk);
			chunks.push(copy);
			owned.push(copy);
		});
		part.on('end', () => {
			result.bytes = Buffer.concat(chunks);
		});
	};
	try {
		signal.throwIfAborted();
		if (!/^multipart\/form-data(?:\s*;|$)/iu.test(contentType)) {
			throw new HttpInputFailure(415, 'unsupported_media_type');
		}
		// Formidable's documented request integration uses only headers and Readable events.
		// The finite source intentionally has no socket: parsing must not own or destroy the real response.
		await form.parse(source as IncomingMessage);
		signal.throwIfAborted();
		if (failure) {
			throw failure;
		}
		return parts;
	} catch (cause) {
		for (const part of parts) {
			part.bytes.fill(0);
		}
		if (cause instanceof HttpInputFailure) {
			throw cause;
		}
		throw new HttpInputFailure(400, 'invalid_multipart', { cause });
	} finally {
		source.destroy();
		for (const chunk of owned) {
			chunk.fill(0);
		}
		bytes.fill(0);
	}
}
