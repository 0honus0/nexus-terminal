import { httpClient } from '@/client/http';
import type { SendFilesRequest, ServerTransferTask } from '../model/serverTransfer';

export const serverTransfersApi = {
  async list(): Promise<ServerTransferTask[]> {
    return (await httpClient.get<ServerTransferTask[]>('/transfers/status')).data;
  },
  async send(request: SendFilesRequest): Promise<ServerTransferTask> {
    return (await httpClient.post<ServerTransferTask>('/transfers/send', request)).data;
  },
  async cancel(taskId: string): Promise<void> {
    await httpClient.post(`/transfers/cancel/${encodeURIComponent(taskId)}`);
  },
  async remove(taskId: string): Promise<void> {
    await httpClient.delete(`/transfers/${encodeURIComponent(taskId)}`);
  },
};
