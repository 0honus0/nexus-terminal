import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type { SendFilesRequestDto, ServerTransferTaskDto } from '@nexus-terminal/protocol/transfers';
import { httpClient } from '@/client/http';
import type { SendFilesRequest, ServerTransferTask } from '../model/serverTransfer';

export const serverTransfersApi = {
  async list(): Promise<ServerTransferTask[]> {
    return (await httpClient.get<ServerTransferTaskDto[]>('/transfers/status')).data;
  },
  async send(request: SendFilesRequest): Promise<ServerTransferTask> {
    const body: SendFilesRequestDto = request;
    return (await httpClient.post<ServerTransferTaskDto>('/transfers/send', body)).data;
  },
  async cancel(taskId: string): Promise<void> {
    await httpClient.post<MessageResponseDto>(`/transfers/cancel/${encodeURIComponent(taskId)}`);
  },
  async remove(taskId: string): Promise<void> {
    await httpClient.delete(`/transfers/${encodeURIComponent(taskId)}`);
  },
};
