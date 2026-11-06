import type { HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { readMultipart, type MultipartPart } from '../../../../platform/http/http-body.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { TargetsPublicApi } from '../../public.js';
import { InvalidTargetPayload, targetArray } from '@nexus-terminal/shared/targets/http';
import {
	TARGET_CONNECTION_IMPORT_FILE_FIELD,
	TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
	TARGET_CONNECTION_IMPORT_MAX_ITEMS,
} from '@nexus-terminal/shared/targets/connections/values';
import {
	readConnectionImportInput,
	readConnectionImportRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import type {
	TargetConnectionImportResponse,
	TargetImportInput,
} from '@nexus-terminal/shared/targets/connections/http';
import { toImportItems } from './target-http-view.js';

async function readItems(request: HttpRequest, reply: HttpReply, signal: AbortSignal): Promise<unknown[]> {
	const contentType = request.headers['content-type'];
	if (typeof contentType !== 'string' || !/^multipart\/form-data(?:\s*;|$)/iu.test(contentType)) {
		return readConnectionImportRequest(request.body).items;
	}
	let parts: MultipartPart[] = [];
	try {
		parts = await readMultipart(
			request,
			reply,
			{
				maxParts: 1,
				maxFileBytes: TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
				maxFieldBytes: TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
			},
			signal,
		);
		const file = parts[0];
		if (
			parts.length !== 1 ||
			!file ||
			file.name !== TARGET_CONNECTION_IMPORT_FILE_FIELD ||
			file.filename === null
		) {
			throw new InvalidTargetPayload();
		}
		if (file.bytes.byteLength > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
			throw new HttpInputFailure(413, 'body_too_large');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
		} catch {
			throw new InvalidTargetPayload();
		}
		const items = targetArray(parsed, (item) => item, TARGET_CONNECTION_IMPORT_MAX_ITEMS);
		if (!items.length) {
			throw new InvalidTargetPayload();
		}
		return items;
	} finally {
		for (const part of parts) {
			part.bytes.fill(0);
		}
	}
}

/** The enclosing management scope revalidates the original session in every item transaction. */
export async function importConnectionRequest(
	request: HttpRequest,
	reply: HttpReply,
	targets: TargetsPublicApi,
): Promise<TargetConnectionImportResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);

	const disconnected = () => controller.abort();

	reply.raw.once('close', disconnected);
	try {
		const sources = await readItems(request, reply, controller.signal);
		const items: TargetConnectionImportResponse['items'] = [];
		for (const source of sources) {
			controller.signal.throwIfAborted();

			let input: TargetImportInput;
			try {
				input = readConnectionImportInput(source);
			} catch (error) {
				if (!(error instanceof InvalidTargetPayload)) {
					throw error;
				}
				items.push({ status: 'error', code: 'invalid_input' });
				continue;
			}
			const result = await targets.importMany([input]);
			controller.signal.throwIfAborted();
			items.push(...toImportItems(result));
		}
		return { items };
	} catch (error) {
		if (controller.signal.aborted && error === controller.signal.reason) {
			throw new HttpInputFailure(408, 'request_timeout');
		}
		throw error;
	} finally {
		clearTimeout(timer);
		reply.raw.off('close', disconnected);
	}
}
