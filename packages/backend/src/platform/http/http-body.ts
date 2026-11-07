import type {} from '@fastify/multipart';
import { HttpInputFailure } from './http-errors.js';
import type { HttpRequest, HttpReply } from './http-types.js';

export interface MultipartPart {
	name: string;
	filename: string | null;
	/** Lowercase media-type essence, without parameters. */
	contentType: string | null;
	bytes: Uint8Array;
}

export interface MultipartLimits {
	maxParts: number;
	maxFileBytes: number;
	maxFieldBytes: number;
}

/**
 * Consume native multipart parts after authorization, enforcing the encoded request budget
 * and each part's limit while clearing partial secrets on failure.
 * Every part is streamed as a file so fields retain exact bytes for strict business decoding.
 */
export async function readMultipart(
	request: HttpRequest,
	reply: HttpReply,
	limits: MultipartLimits,
	signal: AbortSignal,
): Promise<MultipartPart[]> {
	signal.throwIfAborted();
	if (!request.isMultipart()) {
		throw new HttpInputFailure(415, 'unsupported_media_type');
	}
	const maxBytes = request.routeOptions.config.multipartBodyLimit ?? request.routeOptions.bodyLimit;
	const length = request.headers['content-length'];
	if (length !== undefined && (!/^(0|[1-9]\d*)$/u.test(length) || Number(length) > maxBytes)) {
		throw new HttpInputFailure(413, 'body_too_large');
	}
	const parts: MultipartPart[] = [];
	let invalidMetadata = false;
	let receivedBytes = 0;
	let ingressFailure: HttpInputFailure | null = null;

	const count = (chunk: Buffer) => {
		receivedBytes += chunk.byteLength;
		if (receivedBytes > maxBytes && ingressFailure === null) {
			ingressFailure = new HttpInputFailure(413, 'body_too_large');
			request.raw.destroy(ingressFailure);
		}
	};

	const abort = () => request.raw.destroy();

	signal.addEventListener('abort', abort, { once: true });
	try {
		const source = request.parts({
			isPartAFile: () => true,

			limits: {
				parts: limits.maxParts,
				files: limits.maxParts,
				fields: limits.maxParts,
				fileSize: Math.max(limits.maxFileBytes, limits.maxFieldBytes),
				fieldSize: limits.maxFieldBytes,
			},
		});
		// Async iteration installs the plugin parser synchronously before the stream's next tick.
		// Do not pipe a second payload: the native multipart plugin consumes request.raw itself.
		request.raw.prependListener('data', count);
		for await (const part of source) {
			signal.throwIfAborted();
			if (part.type !== 'file') {
				throw new HttpInputFailure(400, 'invalid_multipart');
			}
			const filename = part.filename ?? null;
			const maxBytes = filename === null ? limits.maxFieldBytes : limits.maxFileBytes;
			const chunks: Buffer[] = [];
			let received = 0;

			const partExceeded = () => {
				ingressFailure ??= new HttpInputFailure(413, 'body_too_large');
				if (!request.raw.readableEnded) {
					part.file.destroy(ingressFailure);
				}
			};

			part.file.once('limit', partExceeded);
			try {
				// The parser may reach its limit before yielding the part, or while
				// its consumer waits for a boundary that the client never sends.
				if (part.file.truncated) {
					partExceeded();
				}
				for await (const chunk of part.file) {
					if (!Buffer.isBuffer(chunk)) {
						throw new HttpInputFailure(400, 'invalid_multipart');
					}
					chunks.push(chunk);
					signal.throwIfAborted();
					received += chunk.byteLength;
					if (received > maxBytes) {
						throw new HttpInputFailure(413, 'body_too_large');
					}
				}
				signal.throwIfAborted();
				if (part.file.truncated) {
					throw new HttpInputFailure(413, 'body_too_large');
				}
				parts.push({
					name: part.fieldname,
					filename,
					contentType: part.mimetype?.split(';', 1)[0]?.trim().toLowerCase() ?? null,
					bytes: Buffer.concat(chunks, received),
				});
			} finally {
				part.file.off('limit', partExceeded);
				for (const chunk of chunks) {
					chunk.fill(0);
				}
			}
			if (
				!part.fieldname ||
				part.fieldname.length > 128 ||
				/[\r\n\0]/u.test(part.fieldname) ||
				(filename !== null && (filename.length > 1024 || /[\r\n\0]/u.test(filename)))
			) {
				invalidMetadata = true;
			}
		}
		signal.throwIfAborted();
		if (invalidMetadata) {
			throw new HttpInputFailure(400, 'invalid_multipart');
		}
		return parts;
	} catch (cause) {
		// Stop an unfinished parser immediately, but allow the module to deliver its
		// safe refusal before closing the connection. It must not read an unbounded tail.
		if (!request.raw.readableEnded) {
			request.raw.unpipe();
			request.raw.pause();
			if (reply.raw.destroyed || reply.raw.writableFinished) {
				request.raw.destroy();
			} else {
				reply.header('Connection', 'close');

				const closed = () => {
					reply.raw.off('finish', closed);
					reply.raw.off('close', closed);
					if (reply.raw.writableFinished) {
						request.raw.socket.end();
					} else {
						request.raw.destroy();
					}
				};

				reply.raw.once('finish', closed);
				reply.raw.once('close', closed);
			}
		}
		for (const part of parts) {
			part.bytes.fill(0);
		}
		if (ingressFailure) {
			throw ingressFailure;
		}
		if (signal.aborted) {
			throw signal.reason;
		}
		if (cause instanceof HttpInputFailure) {
			throw cause;
		}
		if (cause instanceof request.server.multipartErrors.RequestFileTooLargeError) {
			throw new HttpInputFailure(413, 'body_too_large', { cause });
		}
		throw new HttpInputFailure(400, 'invalid_multipart', { cause });
	} finally {
		request.raw.off('data', count);
		signal.removeEventListener('abort', abort);
	}
}
