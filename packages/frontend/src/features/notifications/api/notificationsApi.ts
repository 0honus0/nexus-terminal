import type {
  NotificationSettingCreateRequestDto,
  NotificationSettingDto,
  NotificationSettingUpdateRequestDto,
  NotificationTestRequestDto,
  NotificationTestResponseDto,
} from '@nexus-terminal/protocol/notifications';
import { httpClient } from '@/client/http';
import type {
  NotificationSetting,
  NotificationSettingInput,
  NotificationChannelType,
  NotificationConfig,
} from '../model/notification';

export const notificationsApi = {
  async list(): Promise<NotificationSetting[]> {
    return (await httpClient.get<NotificationSettingDto[]>('/notifications')).data;
  },
  async create(input: NotificationSettingInput): Promise<NotificationSetting> {
    const request: NotificationSettingCreateRequestDto = input;
    return (await httpClient.post<NotificationSettingDto>('/notifications', request)).data;
  },
  async update(id: number, input: Partial<NotificationSettingInput>): Promise<NotificationSetting> {
    const request: NotificationSettingUpdateRequestDto = input;
    return (await httpClient.put<NotificationSettingDto>(`/notifications/${id}`, request)).data;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete(`/notifications/${id}`);
  },
  async testSaved(id: number): Promise<NotificationTestResponseDto> {
    return (await httpClient.post<NotificationTestResponseDto>(`/notifications/${id}/test`)).data;
  },
  async testUnsaved(
    channelType: NotificationChannelType,
    config: NotificationConfig,
  ): Promise<NotificationTestResponseDto> {
    const request: NotificationTestRequestDto = { channelType, config };
    return (await httpClient.post<NotificationTestResponseDto>('/notifications/test-unsaved', request)).data;
  },
};
