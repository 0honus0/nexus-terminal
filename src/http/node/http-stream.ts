import { addAbortListener, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { CodedError } from '../../utils/error.js';
import { HttpFailure } from './http-failure.js';
import type { HttpStreamContext, HttpStreamRegistration, HttpStreamResponse } from './http-plugin-api.js';

const streamHeaders = [
	'content-type',
	'cache-control',
	'content-security-policy',
	'content-length',
	'content-disposition',
	'content-range',
	'accept-ranges',
	'etag',
	'last-modified',
] as const;

async function writeStream(
	request: Request,
	response: Response,
	signal: AbortSignal,
	{ status = 200, headers = {}, body }: HttpStreamResponse,
): Promise<void> {
	try {
		signal.throwIfAborted();
		response.status(status).setHeader('X-Content-Type-Options', 'nosniff');
		for (const name of streamHeaders) {
			const value = headers[name];
			if (value !== undefined) response.setHeader(name, value);
		}
		if (body && request.method !== 'HEAD') {
			// 源在首块数据前失败时保留 HTTP 响应，已开始发送则由统一错误边界断开。
			await pipeline(
				body,
				async (source, { signal: transfer = signal } = {}) => {
					for await (const chunk of source) {
						transfer.throwIfAborted();
						if (!response.write(chunk)) await once(response, 'drain', { signal: transfer });
					}
				},
				{ signal },
			);
		}
		response.end();
		await finished(response, { signal, cleanup: true });
	} finally {
		body?.destroy();
	}
}

export async function handleHttpStream(
	{ body, input: schema, handler }: HttpStreamRegistration,
	request: Request,
	response: Response,
	signal: AbortSignal,
): Promise<void> {
	const binary = body === 'binary';
	const headers = request.headers;
	if (
		binary &&
		(headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream' ||
			(headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity'))
	)
		throw new HttpFailure(415, 'HTTP_UNSUPPORTED_MEDIA_TYPE');

	const input = await schema.safeParseAsync({ ...request.query, ...request.params });
	signal.throwIfAborted();
	if (!input.success) throw new HttpFailure(400, 'HTTP_INVALID_REQUEST');

	const bodyStream = binary ? new PassThrough() : undefined;
	let replying: Promise<void> | undefined;
	const context: HttpStreamContext = {
		method: request.method,
		headers: {
			'content-type': headers['content-type'],
			'content-length': headers['content-length'],
			range: headers.range,
			'if-match': headers['if-match'],
			'if-none-match': headers['if-none-match'],
			'if-range': headers['if-range'],
		},
		signal,
		body: bodyStream,

		reply: (options) => {
			if (replying) {
				options.body?.destroy();
				throw new CodedError('HTTP_STREAM_ALREADY_REPLIED');
			}
			if (bodyStream && !bodyStream.readableEnded && (options.status ?? 200) < 400) {
				options.body?.destroy();
				throw new CodedError('HTTP_STREAM_BODY_NOT_CONSUMED');
			}
			if (bodyStream && !bodyStream.readableEnded) response.setHeader('Connection', 'close');
			replying = writeStream(request, response, signal, options);
			void replying.catch(() => undefined);
			return replying;
		},
	};

	// 交给插件的是独立的可读流。撤销上传时停止读取，同时保留还可发送的错误响应。
	const abortBody = () => {
		if (!bodyStream) return;
		request.unpipe(bodyStream);
		const error = signal.reason instanceof Error ? signal.reason : new CodedError('HTTP_UPLOAD_CANCELLED');
		bodyStream.destroy(error);
	};

	using cancelBody = bodyStream && addAbortListener(signal, abortBody);
	if (bodyStream) {
		// 业务可能先检查远端会话再读取流，取消可以先于读者挂上。
		bodyStream.on('error', () => {});
		request.pipe(bodyStream);
	}
	try {
		// Schema 与处理函数在 register() 中已按同一条路由绑定。
		await handler(input.data as never, context);
		if (!replying) throw new CodedError('HTTP_STREAM_REPLY_REQUIRED');
		await replying;
	} finally {
		if (bodyStream) {
			if (!bodyStream.readableEnded && !response.headersSent && !response.destroyed) {
				response.setHeader('Connection', 'close');
			}
			request.unpipe(bodyStream);
			bodyStream.destroy();
		}
		await replying?.catch(() => undefined);
	}
}
