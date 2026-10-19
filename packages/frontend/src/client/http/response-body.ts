import { HttpRequestFailure } from './request-failure';

export async function rejectResponse(response: Response, cause: unknown): Promise<never> {
	try {
		await response.body?.cancel();
	} catch (cleanup) {
		throw new HttpRequestFailure('protocol_failure', 'unknown', {
			cause: new AggregateError([cause, cleanup], 'Response rejection and cleanup failed'),
		});
	}
	throw cause;
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
	const declared = response.headers.get('content-length');
	if (
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1 ||
		(declared !== null &&
			(!/^(0|[1-9][0-9]*)$/u.test(declared) ||
				!Number.isSafeInteger(Number(declared)) ||
				Number(declared) > maxBytes))
	) {
		return rejectResponse(response, new HttpRequestFailure('protocol_failure', 'unknown'));
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw new HttpRequestFailure('protocol_failure', 'unknown');
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	let ended = false;
	const failures: unknown[] = [];
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) {
				ended = true;
				break;
			}
			received += result.value.byteLength;
			if (received > maxBytes) {
				throw new HttpRequestFailure('protocol_failure', 'unknown');
			}
			chunks.push(result.value);
		}
		if (declared !== null && received !== Number(declared) && !response.headers.has('content-encoding')) {
			throw new HttpRequestFailure('protocol_failure', 'unknown');
		}
	} catch (cause) {
		failures.push(cause);
	} finally {
		if (!ended) {
			try {
				await reader.cancel();
			} catch (cause) {
				failures.push(cause);
			}
		}
		try {
			reader.releaseLock();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		const cause =
			failures.length === 1 ? failures[0] : new AggregateError(failures, 'Response read and cleanup failed');
		if (cause instanceof HttpRequestFailure) {
			throw cause;
		}
		throw new HttpRequestFailure('request_failed', 'unknown', { cause });
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
