import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { beginHttpDiagnostic } from '../logging/transport-diagnostics';
import { logger } from '../logging/logger';
import { dispatchUnauthorized } from './unauthorized';
import { clearPendingNetworkFailure, isNetworkFailure, reportNetworkFailure } from './network-failure';

export { setUnauthorizedHandler } from './unauthorized';

export interface ApiErrorBody {
	message?: string;
	error?: string;
}

export const httpClient: AxiosInstance = axios.create({
	baseURL: '/api/v1',
	timeout: 15_000,
	withCredentials: true,
});

const diagnostics = new WeakMap<InternalAxiosRequestConfig, ReturnType<typeof beginHttpDiagnostic>>();

const requestPath = (url: string | undefined): string => url?.split(/[?#]/, 1)[0] || 'unknown';

const requestMethod = (method: string | undefined): string => method?.toUpperCase() || 'UNKNOWN';

const isExplicitLogoutRequest = (url: string | undefined): boolean => requestPath(url).endsWith('/auth/logout');

httpClient.interceptors.request.use((config) => {
	diagnostics.set(config, beginHttpDiagnostic(requestMethod(config.method), httpClient.getUri(config)));
	return config;
});

httpClient.interceptors.response.use(
	(response) => {
		diagnostics.get(response.config)?.(response.status);
		diagnostics.delete(response.config);
		if (response.config.method?.toUpperCase() === 'GET') {
			clearPendingNetworkFailure(httpClient.getUri(response.config));
		}
		return response;
	},
	(error: unknown) => {
		if (axios.isAxiosError(error)) {
			if (isNetworkFailure(error)) {
				reportNetworkFailure(
					error.config?.method?.toUpperCase() === 'GET' ? httpClient.getUri(error.config) : undefined,
					error.config?.signal instanceof AbortSignal ? error.config.signal : undefined,
				);
			} else if (error.response && error.config?.method?.toUpperCase() === 'GET') {
				clearPendingNetworkFailure(httpClient.getUri(error.config));
			}
			if (error.config) {
				diagnostics.get(error.config)?.(
					error.response?.status ?? null,
					axios.isCancel(error) ? 'cancelled' : error.response ? undefined : 'request_failed',
				);
				diagnostics.delete(error.config);
			}
		} else {
			logger.warn({ err: error }, 'Unexpected HTTP client failure');
		}

		if (
			axios.isAxiosError(error) &&
			error.response?.status === 401 &&
			!isExplicitLogoutRequest(error.config?.url)
		) {
			dispatchUnauthorized(requestPath(error.config?.url));
		}
		return Promise.reject(error);
	},
);

export const apiErrorStatus = (error: unknown): number | undefined =>
	axios.isAxiosError(error) ? error.response?.status : undefined;

export const apiErrorMessage = (error: unknown, fallback: string): string => {
	if (axios.isAxiosError<ApiErrorBody>(error)) {
		return error.response?.data?.message || error.response?.data?.error || error.message || fallback;
	}
	return error instanceof Error ? error.message : fallback;
};
