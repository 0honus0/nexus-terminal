import axios, { type AxiosInstance } from 'axios';
import { logger } from '../logging/logger';

export interface ApiErrorBody {
  message?: string;
  error?: string;
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 15_000,
  withCredentials: true,
});

export type UnauthorizedHandler = () => void | Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let handlingUnauthorized = false;

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null): void => {
  unauthorizedHandler = handler;
};

const requestPath = (url: string | undefined): string => url?.split(/[?#]/, 1)[0] || 'unknown';
const requestMethod = (method: string | undefined): string => method?.toUpperCase() || 'UNKNOWN';

const isExplicitLogoutRequest = (url: string | undefined): boolean => requestPath(url).endsWith('/auth/logout');

httpClient.interceptors.request.use((config) => {
  logger.trace({ method: requestMethod(config.method), path: requestPath(config.url) }, 'HTTP request dispatch');
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const context = {
        method: requestMethod(error.config?.method),
        path: requestPath(error.config?.url),
        statusCode: error.response?.status,
        errorCode: error.code,
      };
      if (!error.response || (error.response.status ?? 0) >= 500) logger.warn(context, 'HTTP request failed');
      else logger.debug(context, 'HTTP request rejected');
    } else {
      logger.warn({ err: error }, 'Unexpected HTTP client failure');
    }

    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !isExplicitLogoutRequest(error.config?.url) &&
      unauthorizedHandler &&
      !handlingUnauthorized
    ) {
      handlingUnauthorized = true;
      logger.debug({ path: requestPath(error.config?.url) }, 'Dispatching HTTP session-loss handler');
      void Promise.resolve(unauthorizedHandler())
        .catch((cause) => logger.error({ err: cause }, 'Failed to handle HTTP session loss'))
        .finally(() => {
          handlingUnauthorized = false;
        });
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
