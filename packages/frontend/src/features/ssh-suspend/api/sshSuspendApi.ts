import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type {
  SuspendedSessionDto,
  SuspendedSessionRenameRequestDto,
  SuspendedSessionRenameResponseDto,
} from '@nexus-terminal/protocol/ssh-suspend';
import { httpClient } from '@/client/http';

export const sshSuspendApi = {
  async list(): Promise<SuspendedSessionDto[]> {
    return (await httpClient.get<SuspendedSessionDto[]>('/ssh-suspend/suspended-sessions')).data;
  },

  async terminate(id: string): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/ssh-suspend/terminate/${encodeURIComponent(id)}`);
  },

  async removeDisconnected(id: string): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/ssh-suspend/entry/${encodeURIComponent(id)}`);
  },

  async rename(id: string, customName: string): Promise<string> {
    const request: SuspendedSessionRenameRequestDto = { customName };
    const { data } = await httpClient.put<SuspendedSessionRenameResponseDto>(
      `/ssh-suspend/name/${encodeURIComponent(id)}`,
      request,
    );
    return data.customName;
  },

  async exportLog(id: string): Promise<string> {
    const response = await httpClient.get<Blob>(`/ssh-suspend/log/${encodeURIComponent(id)}`, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] ?? `ssh-session-${id.slice(0, 8)}.log`;
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
};
