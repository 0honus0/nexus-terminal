import { logger } from '../logging/logger';

export type UnauthorizedHandler = () => void | Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let handlingUnauthorized = false;

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null): void => {
	unauthorizedHandler = handler;
};

/** One session-loss dispatch across Axios and bounded fetch-based JSON clients. */
export const dispatchUnauthorized = (path: string): void => {
	if (!unauthorizedHandler || handlingUnauthorized) return;
	handlingUnauthorized = true;
	logger.debug({ path }, 'Dispatching HTTP session-loss handler');
	void Promise.resolve()
		.then(() => unauthorizedHandler?.())
		.catch((cause) => logger.error({ err: cause }, 'Failed to handle HTTP session loss'))
		.finally(() => {
			handlingUnauthorized = false;
		});
};
