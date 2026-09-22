import type {
  ConnectionAddTagRequestDto,
  ConnectionCloneRequestDto,
  ConnectionCreateRequestDto,
  ConnectionDto,
  ConnectionMutationResponseDto,
  ConnectionTestResponseDto,
  ConnectionUpdateRequestDto,
} from '@nexus-terminal/protocol/connections';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { Connection, ConnectionInput, ConnectionTestResult, ConnectionUpdate } from '../model/connection';

export const connectionsApi = {
  async list(): Promise<Connection[]> {
    return (await httpClient.get<ConnectionDto[]>('/connections')).data;
  },
  async get(id: number): Promise<Connection> {
    return (await httpClient.get<ConnectionDto>(`/connections/${id}`)).data;
  },
  async create(input: ConnectionInput): Promise<Connection> {
    const request: ConnectionCreateRequestDto = input;
    const response = await httpClient.post<ConnectionMutationResponseDto>('/connections', request);
    return response.data.connection;
  },
  async update(id: number, input: ConnectionUpdate): Promise<Connection> {
    const request: ConnectionUpdateRequestDto = input;
    const response = await httpClient.put<ConnectionMutationResponseDto>(`/connections/${id}`, request);
    return response.data.connection;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/connections/${id}`);
  },
  async test(id: number): Promise<ConnectionTestResult> {
    return (await httpClient.post<ConnectionTestResponseDto>(`/connections/${id}/test`)).data;
  },
  async testUnsaved(input: ConnectionInput): Promise<ConnectionTestResult> {
    const request: ConnectionCreateRequestDto = input;
    return (await httpClient.post<ConnectionTestResponseDto>('/connections/test-unsaved', request)).data;
  },
  async clone(id: number, name: string): Promise<Connection> {
    const request: ConnectionCloneRequestDto = { name };
    const response = await httpClient.post<ConnectionMutationResponseDto>(`/connections/${id}/clone`, request);
    return response.data.connection;
  },
  async addTag(connectionIds: number[], tagId: number): Promise<void> {
    const request: ConnectionAddTagRequestDto = { connectionIds, tagId };
    await httpClient.post<MessageResponseDto>('/connections/add-tag', request);
  },
};
