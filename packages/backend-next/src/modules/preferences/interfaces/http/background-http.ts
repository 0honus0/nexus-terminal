import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { withAppearanceDeadline } from './appearance-http-deadline.js';
import { readBodyBytes, decodeMultipart } from '../../../../platform/http/http-body.js';
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
import { authenticate, revalidate, ready, deliver, handle } from './appearance-http-support.js';

function toWireBackground(value: BackgroundMutation): BackgroundMutationResponse {
	return { appearance: toWireAppearance(value.appearance), cleanupPending: value.cleanupPending };
}

async function readUpload(
	context: HttpRouteContext,
	kind: BackgroundKind,
	signal: AbortSignal,
): Promise<BackgroundUpload> {
	const type = context.request.headers['content-type'];
	if (typeof type !== 'string') {
		throw new AppearanceFailure('unsupported_media_type');
	}
	const parts = decodeMultipart(
		await readBodyBytes(context.request, BACKGROUND_MULTIPART_MAX_BYTES, signal),
		type,
		2,
	);
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
}

function writeChunk(context: HttpRouteContext, chunk: Uint8Array, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted || context.response.destroyed) {
			reject(new AppearanceFailure('unavailable'));
			return;
		}

		const disconnected = () => {
			finish(new AppearanceFailure('unavailable'));
		};

		const aborted = () => {
			context.response.destroy();
			finish(new AppearanceFailure('unavailable'));
		};

		const finish = (error?: Error | null) => {
			context.response.off('close', disconnected);
			context.response.off('error', finish);
			signal.removeEventListener('abort', aborted);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};

		context.response.on('close', disconnected);
		context.response.once('error', finish);
		signal.addEventListener('abort', aborted, { once: true });
		try {
			context.response.write(chunk, finish);
		} catch (cause) {
			finish(cause instanceof Error ? cause : new AppearanceFailure('internal_failure', { cause }));
		}
	});
}

async function transfer(context: HttpRouteContext, content: BackgroundContent, signal: AbortSignal): Promise<void> {
	ready(context);
	context.response.setHeader('Content-Type', content.mediaType);
	context.response.setHeader('Content-Length', String(content.sizeBytes));
	context.response.setHeader(
		'Content-Security-Policy',
		"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
	);
	context.response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
	context.response.setHeader('X-Content-Type-Options', 'nosniff');
	context.response.setHeader('Cache-Control', 'private, no-store');
	await content.transfer((chunk) => writeChunk(context, chunk, signal));
	await new Promise<void>((resolve, reject) => {
		if (signal.aborted || context.response.destroyed) {
			reject(new AppearanceFailure('unavailable'));
			return;
		}

		const closed = () => {
			if (context.response.writableFinished) {
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
			context.response.destroy();
			failed(new AppearanceFailure('unavailable'));
		};

		const cleanup = () => {
			context.response.off('finish', finished);
			context.response.off('close', closed);
			context.response.off('error', failed);
			signal.removeEventListener('abort', aborted);
		};

		context.response.once('finish', finished);
		context.response.on('close', closed);
		context.response.once('error', failed);
		signal.addEventListener('abort', aborted, { once: true });
		try {
			context.response.end();
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
				path: path + '/' + kind,
				maxBodyBytes: BACKGROUND_MULTIPART_MAX_BYTES,

				handle: (context) =>
					handle(context, () =>
						withAppearanceDeadline(context, async (signal) => {
							const actor = await authenticate(context, access);
							const result = await service.upload(
								actor,
								async (active) => {
									const input = await readUpload(context, kind, active);
									await revalidate(context, access, actor);
									ready(context);
									return input;
								},
								signal,
							);
							await deliver(context, access, actor, () => toWireBackground(result));
						}),
					),
			},
			{
				method: 'DELETE',
				path: path + '/' + kind,

				handle: (context) =>
					handle(context, () =>
						withAppearanceDeadline(context, async (signal) => {
							const actor = await authenticate(context, access);
							const input = readBackgroundDelete(await context.json(signal));
							await revalidate(context, access, actor);
							ready(context);
							const result = await service.remove(actor, kind, input.expectedVersion, signal);
							await deliver(context, access, actor, () => toWireBackground(result));
						}),
					),
			},
		);
	}
	routes.push({
		method: 'GET',
		path: path + '/file/:filename',

		handle: (context) =>
			handle(context, () =>
				withAppearanceDeadline(context, async (signal) => {
					const actor = await authenticate(context, access);
					const parameters = readBackgroundFilePath(context.params.filename);
					await service.read(actor, parameters.filename, signal, async (content, active) => {
						await revalidate(context, access, actor);
						await transfer(context, content, active);
					});
				}),
			),
	});
	return routes;
}
