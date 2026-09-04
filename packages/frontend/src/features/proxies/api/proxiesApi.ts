import { httpClient } from '@/client/http';
import type { Proxy, ProxyInput } from '../model/proxy';
export const proxiesApi = {
  async list(): Promise<Proxy[]> {
    return (await httpClient.get<Proxy[]>('/proxies')).data;
  },
  async create(input: ProxyInput): Promise<Proxy> {
    return (await httpClient.post<{ proxy: Proxy }>('/proxies', input)).data.proxy;
  },
  async update(id: number, input: Partial<ProxyInput>): Promise<Proxy> {
    return (await httpClient.put<{ proxy: Proxy }>(`/proxies/${id}`, input)).data.proxy;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete(`/proxies/${id}`);
  },
};
