import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
import { readMultipart } from '../../../../platform/http/http-body.js';
import {
	BACKGROUND_MULTIPART_MAX_BYTES,
	BACKGROUND_MAX_BYTES,
	BACKGROUND_MEDIA_TYPES,
	type BackgroundKind,
} from '@nexus-terminal/shared/preferences/appearance/values';
import {
	readBackgroundUploadFields,
	readBackgroundDelete,
	readBackgroundFilePath,
} from '@nexus-terminal/shared/preferences/appearance/http-codec';
import type { BackgroundMutationResponse } from '@nexus-terminal/shared/preferences/appearance/http';
import type { AccessPublicApi } from '../../../access/public.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import type { BackgroundService } from '../../appearance/service/background-service.js';
import type {
	BackgroundUpload,
	BackgroundMutation,
	BackgroundContent,
} from '../../appearance/model/background-types.js';
import { toWireAppearance } from './appearance-mapper.js';
import {
	authenticate,
	revalidate,
	ready,
	deliver,
	handle,
	readAppearanceInput,
	appearanceHttpErrorHandler,
} from './appearance-http-support.js';

function toWireBackground(value: BackgroundMutation): BackgroundMutationResponse {
	return { appearance: toWireAppearance(value.appearance), cleanupPending: value.cleanupPending };
}

async function readUpload(
	request: HttpRequest,
	reply: HttpReply,
	kind: BackgroundKind,
	signal: AbortSignal,
): Promise<BackgroundUpload> {
	const type = request.raw.headers['content-type'];
	if (typeof type !== 'string') {
		throw new AppearanceFailure('unsupported_media_type');
	}
	const parts = await readMultipart(
		request,
		reply,
		{
			maxParts: 2,
			maxFileBytes: BACKGROUND_MAX_BYTES,
			maxFieldBytes: 16,
		},
		signal,
	);
	try {
		const file = parts.find(
			(part) => part.name === (kind === 'page' ? 'pageBackgroundFile' : 'terminalBackgroundFile'),
		);
		const version = parts.find((part) => part.name === 'expectedVersion');
		if (
			!file ||
			file.filename === null ||
			!version ||
			version.filename !== null ||
			parts.some((part) => part !== file && part !== version) ||
			version.bytes.byteLength > 16
		) {
			throw new AppearanceFailure('invalid_input');
		}
		if (file.bytes.byteLength > BACKGROUND_MAX_BYTES) {
			throw new AppearanceFailure('limit_exceeded');
		}
		const mediaType = BACKGROUND_MEDIA_TYPES.find((type) => type === file.contentType);
		if (!mediaType) {
			throw new AppearanceFailure('unsupported_media_type');
		}
		let rawVersion: string;
		try {
			rawVersion = new TextDecoder('utf-8', { fatal: true }).decode(version.bytes);
		} catch (cause) {
			throw new AppearanceFailure('invalid_input', { cause });
		}
		if (!/^[1-9]\d*$/u.test(rawVersion)) {
			throw new AppearanceFailure('invalid_input');
		}
		const fields = readBackgroundUploadFields({ expectedVersion: Number(rawVersion) });
		return { kind, expectedVersion: fields.expectedVersion, bytes: Uint8Array.from(file.bytes), mediaType };
	} finally {
		for (const part of parts) {
			part.bytes.fill(0);
		}
	}
}

function writeChunk(request: HttpRequest, reply: HttpReply, chunk: Uint8Array, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted || reply.raw.destroyed) {
			reject(new AppearanceFailure('unavailable'));
			return;
		}

		const disconnected = () => {
			finish(new AppearanceFailure('unavailable'));
		};

		const aborted = () => {
			reply.raw.destroy();
			finish(new AppearanceFailure('unavailable'));
		};

		const finish = (error?: Error | null) => {
			reply.raw.off('close', disconnected);
			reply.raw.off('error', finish);
			signal.removeEventListener('abort', aborted);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};

		reply.raw.on('close', disconnected);
		reply.raw.once('error', finish);
		signal.addEventListener('abort', aborted, { once: true });
		try {
			reply.raw.write(chunk, finish);
		} catch (cause) {
			finish(cause instanceof Error ? cause : new AppearanceFailure('internal_failure', { cause }));
		}
	});
}

async function transfer(
	request: HttpRequest,
	reply: HttpReply,
	content: BackgroundContent,
	signal: AbortSignal,
): Promise<void> {
	ready(request, reply);
	signal.throwIfAborted();
	let started = false;

	const start = () => {
		if (started) {
			return;
		}
		ready(request, reply);
		signal.throwIfAborted();
		reply.raw.setHeader('Content-Type', content.mediaType);
		reply.raw.setHeader('Content-Length', String(content.sizeBytes));
		reply.raw.setHeader('Cache-Control', 'private, no-store');
		reply.hijack();
		started = true;
	};

	// A source can fail before yielding any bytes. Keep native error replies available
	// until the first actual write, then let the original transfer own termination.
	await content.transfer((chunk) => {
		if (!chunk.byteLength) {
			return Promise.resolve();
		}
		start();
		return writeChunk(request, reply, chunk, signal);
	});
	start();
	await new Promise<void>((resolve, reject) => {
		if (signal.aborted || reply.raw.destroyed) {
			reject(new AppearanceFailure('unavailable'));
			return;
		}

		const closed = () => {
			if (reply.raw.writableFinished) {
				finished();
			} else {
				failed(new AppearanceFailure('unavailable'));
			}
		};

		const finished = () => {
			cleanup();
			resolve();
		};

		const failed = (cause: unknown) => {
			cleanup();
			reject(new AppearanceFailure('unavailable', { cause }));
		};

		const aborted = () => {
			reply.raw.destroy();
			failed(new AppearanceFailure('unavailable'));
		};

		const cleanup = () => {
			reply.raw.off('finish', finished);
			reply.raw.off('close', closed);
			reply.raw.off('error', failed);
			signal.removeEventListener('abort', aborted);
		};

		reply.raw.once('finish', finished);
		reply.raw.on('close', closed);
		reply.raw.once('error', failed);
		signal.addEventListener('abort', aborted, { once: true });
		try {
			reply.raw.end();
		} catch (cause) {
			failed(cause);
		}
	});
}

export function createBackgroundRoutes(service: BackgroundService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/appearance/background';
	const routes: HttpRoute[] = [];
	for (const kind of ['page', 'terminal'] as const) {
		routes.push(
			{
				method: 'POST',
				url: path + '/' + kind,
				bodyLimit: BACKGROUND_MULTIPART_MAX_BYTES,
				config: { multipartBodyLimit: BACKGROUND_MULTIPART_MAX_BYTES },

				errorHandler: appearanceHttpErrorHandler,

				handler: (request, reply) =>
					handle(request, reply, () =>
						withAppearanceDeadline(request, reply, async (signal) => {
							const actor = await authenticate(request, reply, access);
							const result = await service.upload(
								actor,
								(active) =>
									readAppearanceInput(active, async () => {
										const input = await readUpload(request, reply, kind, active);
										await revalidate(request, reply, access, actor);
										ready(request, reply);
										active.throwIfAborted();
										return input;
									}),
								signal,
							);
							await deliver(request, reply, access, actor, () => toWireBackground(result));
						}),
					),
			},
			{
				method: 'DELETE',
				url: path + '/' + kind,

				errorHandler: appearanceHttpErrorHandler,

				handler: (request, reply) =>
					handle(request, reply, () =>
						withAppearanceDeadline(request, reply, async (signal) => {
							const actor = await authenticate(request, reply, access);
							const input = readBackgroundDelete(request.body);
							await revalidate(request, reply, access, actor);
							ready(request, reply);
							const result = await service.remove(actor, kind, input.expectedVersion, signal);
							await deliver(request, reply, access, actor, () => toWireBackground(result));
						}),
					),
			},
		);
	}
	routes.push({
		method: 'GET',
		url: path + '/file/:filename',
		helmet: {
			contentSecurityPolicy: {
				useDefaults: false,
				directives: {
					sandbox: [],
					defaultSrc: ["'none'"],
					styleSrc: ["'unsafe-inline'"],
					imgSrc: ['data:', 'blob:'],
				},
			},
			crossOriginResourcePolicy: { policy: 'same-origin' },
		},

		errorHandler: appearanceHttpErrorHandler,

		handler: (request, reply) =>
			handle(request, reply, () =>
				withAppearanceDeadline(request, reply, async (signal) => {
					const actor = await authenticate(request, reply, access);
					const parameters = readBackgroundFilePath(request.params.filename);
					await service.read(actor, parameters.filename, signal, async (content, active) => {
						await revalidate(request, reply, access, actor);
						await transfer(request, reply, content, active);
					});
				}),
			),
	});
	return routes;
}
