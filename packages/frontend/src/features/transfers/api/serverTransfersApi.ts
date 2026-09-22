import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type { SendFilesRequestDto, ServerTransferTaskDto } from '@nexus-terminal/protocol/transfers';
import { httpClient } from '@/client/http';

export const serverTransfersApi = {
  async list(): Promise<ServerTransferTaskDto[]> {
    return (await httpClient.get<ServerTransferTaskDto[]>('/transfers/status')).data;
  },
  async send(request: SendFilesRequestDto): Promise<ServerTransferTaskDto> {
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
