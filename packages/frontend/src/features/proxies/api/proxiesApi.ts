import type {
  ProxyCreateRequestDto,
  ProxyDto,
  ProxyMutationResponseDto,
  ProxyUpdateRequestDto,
} from '@nexus-terminal/protocol/connections';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';

export const proxiesApi = {
  async list(): Promise<ProxyDto[]> {
    return (await httpClient.get<ProxyDto[]>('/proxies')).data;
  },
  async create(input: ProxyCreateRequestDto): Promise<ProxyDto> {
    const request: ProxyCreateRequestDto = input;
    return (await httpClient.post<ProxyMutationResponseDto>('/proxies', request)).data.proxy;
  },
  async update(id: number, input: Partial<ProxyCreateRequestDto>): Promise<ProxyDto> {
    const request: ProxyUpdateRequestDto = input;
    return (await httpClient.put<ProxyMutationResponseDto>(`/proxies/${id}`, request)).data.proxy;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/proxies/${id}`);
  },
};
