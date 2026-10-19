import type { HttpRouteContext } from '../../../../platform/http/http-types.js';
import { accessBoundary } from '../../access-errors.js';

/** Retain committed credentials until HTTP finishes handing off the response. */
export async function deliverAccessResult<T>(
	context: HttpRouteContext,
	issue: (signal: AbortSignal) => Promise<T>,
	send: (issued: T) => void,
	revoke: (issued: T) => Promise<void>,
): Promise<void> {
	const cancellation = new AbortController();
	let responseFinished = false;
	const socket = context.response.socket;

	let completed: (delivered: boolean) => void = () => undefined;

	const delivered = new Promise<boolean>((resolve) => {
		completed = resolve;
	});

	const onFinish = () => {
		responseFinished = !context.response.destroyed && socket?.destroyed !== true && !context.request.aborted;
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

	context.response.once('finish', onFinish);
	context.response.once('close', onClose);
	socket?.once('close', onClose);
	context.request.once('aborted', onClose);
	if (context.response.destroyed || socket?.destroyed || context.request.aborted) {
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
		if (cancellation.signal.aborted || context.response.destroyed) {
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
		context.response.off('finish', onFinish);
		context.response.off('close', onClose);
		socket?.off('close', onClose);
		context.request.off('aborted', onClose);
	}
}
