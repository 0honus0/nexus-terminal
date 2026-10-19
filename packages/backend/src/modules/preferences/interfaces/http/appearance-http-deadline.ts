import type { HttpRouteContext } from '../../../../platform/http/http-types.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import { HtmlThemeFailure } from '../../html-theme-failure.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';

export async function withAppearanceDeadline<T>(
	context: HttpRouteContext,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60000);

	const disconnected = () => {
		if (!context.response.writableFinished) {
			controller.abort();
		}
	};

	context.response.on('close', disconnected);

	const transportFailed = () => controller.abort();

	context.response.on('error', transportFailed);
	try {
		return await work(controller.signal);
	} catch (cause) {
		const classified =
			cause instanceof AppearanceFailure ||
			cause instanceof HtmlThemeFailure ||
			cause instanceof AccessOperationError ||
			cause instanceof HttpInputFailure ||
			cause instanceof InvalidPayload ||
			cause instanceof SyntaxError;
		if (controller.signal.aborted && !classified) {
			throw new AppearanceFailure('unavailable', { cause });
		}
		throw cause;
	} finally {
		clearTimeout(timer);
		context.response.off('close', disconnected);
		context.response.off('error', transportFailed);
	}
}
