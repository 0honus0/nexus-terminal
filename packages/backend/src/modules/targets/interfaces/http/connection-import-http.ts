import type { HttpRouteContext } from '../../../../platform/http/http-types.js';
import { decodeMultipart, readBodyBytes, type MultipartPart } from '../../../../platform/http/http-body.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { TargetsPublicApi } from '../../public.js';
import { InvalidTargetPayload, targetArray } from '@nexus-terminal/shared/targets/http';
import {
	TARGET_CONNECTION_IMPORT_FILE_FIELD,
	TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
	TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES,
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

async function readItems(context: HttpRouteContext, signal: AbortSignal): Promise<unknown[]> {
	const contentType = context.request.headers['content-type'];
	if (typeof contentType !== 'string' || !/^multipart\/form-data(?:\s*;|$)/iu.test(contentType)) {
		return readConnectionImportRequest(await context.json(signal)).items;
	}
	const bytes = await readBodyBytes(context.request, TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES, signal);
	let parts: MultipartPart[] = [];
	try {
		parts = decodeMultipart(bytes, contentType, 1);
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
		bytes.fill(0);
	}
}

/** The enclosing management scope revalidates the original session in every item transaction. */
export async function importConnectionRequest(
	context: HttpRouteContext,
	targets: TargetsPublicApi,
): Promise<TargetConnectionImportResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);

	const disconnected = () => controller.abort();

	context.response.once('close', disconnected);
	try {
		const sources = await readItems(context, controller.signal);
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
		context.response.off('close', disconnected);
	}
}
