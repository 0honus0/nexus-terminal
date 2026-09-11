import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { httpClient } from '@/client/http';
import { toAgentApiError } from './agent-api-error';

const normalizeAgentRequest = async <T>(request: Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> => {
  try {
    return await request;
  } catch (cause) {
    throw toAgentApiError(cause);
  }
};

export const agentHttpClient = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return normalizeAgentRequest(httpClient.get<T>(url, config));
  },

  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return normalizeAgentRequest(httpClient.delete<T>(url, config));
  },

  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return normalizeAgentRequest(httpClient.post<T>(url, data, config));
  },

  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return normalizeAgentRequest(httpClient.put<T>(url, data, config));
  },

  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return normalizeAgentRequest(httpClient.patch<T>(url, data, config));
  },
};
