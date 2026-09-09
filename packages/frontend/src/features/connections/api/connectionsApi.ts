import { httpClient } from '@/client/http';
import type { Connection, ConnectionInput, ConnectionTestResult, ConnectionUpdate } from '../model/connection';

export const connectionsApi = {
  async list(): Promise<Connection[]> {
    return (await httpClient.get<Connection[]>('/connections')).data;
  },
  async get(id: number): Promise<Connection> {
    return (await httpClient.get<Connection>(`/connections/${id}`)).data;
  },
  async create(input: ConnectionInput): Promise<Connection> {
    const response = await httpClient.post<{ connection: Connection }>('/connections', input);
    return response.data.connection;
  },
  async update(id: number, input: ConnectionUpdate): Promise<Connection> {
    const response = await httpClient.put<{ connection: Connection }>(`/connections/${id}`, input);
    return response.data.connection;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete(`/connections/${id}`);
  },
  async test(id: number): Promise<ConnectionTestResult> {
    return (await httpClient.post<ConnectionTestResult>(`/connections/${id}/test`)).data;
  },
  async testUnsaved(input: ConnectionInput): Promise<ConnectionTestResult> {
    return (await httpClient.post<ConnectionTestResult>('/connections/test-unsaved', input)).data;
  },
  async clone(id: number, name: string): Promise<Connection> {
    const response = await httpClient.post<{ connection: Connection }>(`/connections/${id}/clone`, { name });
    return response.data.connection;
  },
  async addTag(connectionIds: number[], tagId: number): Promise<void> {
    await httpClient.post('/connections/add-tag', { connectionIds, tagId });
  },
};
