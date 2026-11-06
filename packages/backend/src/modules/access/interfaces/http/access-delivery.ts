import type { HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { accessBoundary } from '../../access-errors.js';

/** Retain committed credentials until HTTP finishes handing off the response. */
export async function deliverAccessResult<T>(
	request: HttpRequest,
	reply: HttpReply,
	issue: (signal: AbortSignal) => Promise<T>,
	send: (issued: T) => void,
	revoke: (issued: T) => Promise<void>,
): Promise<void> {
	const cancellation = new AbortController();
	let responseFinished = false;
	const socket = reply.raw.socket;

	let completed: (delivered: boolean) => void = () => undefined;

	const delivered = new Promise<boolean>((resolve) => {
		completed = resolve;
	});

	const onFinish = () => {
		responseFinished =
			reply.raw.statusCode >= 200 &&
			reply.raw.statusCode < 300 &&
			!reply.raw.destroyed &&
			socket?.destroyed !== true &&
			!request.raw.aborted;
		if (!responseFinished) {
			cancellation.abort();
		}
		completed(responseFinished);
	};

	const onClose = () => {
		if (!responseFinished) {
			cancellation.abort();
		}
		// Destruction can discard the writable buffer and make writableFinished true without finish.
		completed(responseFinished);
	};

	reply.raw.once('finish', onFinish);
	reply.raw.once('close', onClose);
	socket?.once('close', onClose);
	request.raw.once('aborted', onClose);
	if (reply.raw.destroyed || socket?.destroyed || request.raw.aborted) {
		cancellation.abort();
	}

	let issued: { value: T } | null = null;
	let cleanupStarted = false;

	const cleanup = async () => {
		if (issued === null || cleanupStarted) {
			return;
		}
		cleanupStarted = true;
		const value = issued.value;
		await accessBoundary(() => revoke(value));
	};

	try {
		issued = { value: await accessBoundary(() => issue(cancellation.signal)) };
		if (cancellation.signal.aborted || reply.raw.destroyed) {
			await cleanup();
			return;
		}
		send(issued.value);
		if (!(await delivered)) {
			await cleanup();
		}
	} catch (error) {
		try {
			await cleanup();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Access delivery and cleanup failed');
		}
		throw error;
	} finally {
		reply.raw.off('finish', onFinish);
		reply.raw.off('close', onClose);
		socket?.off('close', onClose);
		request.raw.off('aborted', onClose);
	}
}
