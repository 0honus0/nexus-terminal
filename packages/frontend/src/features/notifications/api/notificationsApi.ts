import { httpClient } from '@/client/http';
import type {
  NotificationSetting,
  NotificationSettingInput,
  NotificationChannelType,
  NotificationConfig,
} from '../model/notification';
export const notificationsApi = {
  async list(): Promise<NotificationSetting[]> {
    return (await httpClient.get<NotificationSetting[]>('/notifications')).data;
  },
  async create(input: NotificationSettingInput): Promise<NotificationSetting> {
    return (await httpClient.post<NotificationSetting>('/notifications', input)).data;
  },
  async update(id: number, input: Partial<NotificationSettingInput>): Promise<NotificationSetting> {
    return (await httpClient.put<NotificationSetting>(`/notifications/${id}`, input)).data;
  },
  async remove(id: number) {
    await httpClient.delete(`/notifications/${id}`);
  },
  async testSaved(id: number) {
    return (await httpClient.post<{ success: boolean; message: string }>(`/notifications/${id}/test`)).data;
  },
  async testUnsaved(channelType: NotificationChannelType, config: NotificationConfig) {
    return (
      await httpClient.post<{ success: boolean; message: string }>('/notifications/test-unsaved', {
        channelType,
        config,
      })
    ).data;
  },
};
