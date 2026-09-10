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

const isExplicitLogoutRequest = (url: string | undefined): boolean =>
  Boolean(url?.split('?', 1)[0]?.endsWith('/auth/logout'));

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !isExplicitLogoutRequest(error.config?.url) &&
      unauthorizedHandler &&
      !handlingUnauthorized
    ) {
      handlingUnauthorized = true;
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
