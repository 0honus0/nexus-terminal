import axios, { type AxiosInstance } from 'axios';

export interface ApiErrorBody {
  message?: string;
  error?: string;
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 15_000,
  withCredentials: true,
});

export const apiErrorStatus = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : undefined;

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.message || error.response?.data?.error || error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
};
